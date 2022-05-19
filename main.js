require('dotenv').config()
const puppeteer = require('puppeteer')
const weekDays = require('i18n-week-days')
const axios = require('axios')
const FormData = require('form-data')
const { PDFDocument } = require('pdf-lib')
const { PDFImage } = require('pdf-image')
const fs = require('fs')

const SLACK_FILE_UPLOAD_URL = 'https://slack.com/api/files.upload'
const NOON_CPH_MENU_LINK = 'https://www.nooncph.dk/ugens-menuer'

function log (message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function getPageNumber (date) {
  const weekDayInHumanFormat = date.toLocaleString('en-us', {  weekday: 'long' }).toLowerCase()
  const isFullNoon = process.env.FULL_NOON_DAYS.split(',').includes(weekDayInHumanFormat)
  const isGreenNoon = !isFullNoon
  const isDanishLanguageSpecified = process.env.LANGUAGE === 'da'

  if (isGreenNoon && isDanishLanguageSpecified) return 0
  if (isGreenNoon && !isDanishLanguageSpecified) return 1
  if (isFullNoon && isDanishLanguageSpecified) return 2
  if (isFullNoon && !isDanishLanguageSpecified) return 3
}

function getWeekNumber (date) {
  const firstOfJan = new Date(date.getFullYear(), 0, 1)
  const weekNumber = Math.floor((((date.getTime() - firstOfJan.getTime()) / 86400000) + firstOfJan.getDay() + 1) / 7)
  return weekNumber
}

function getDanishWeekDay (date) {
  return weekDays['da'][date.getDay() - 1]
}

async function getLunchLink (date) {
  const weekNumber = getWeekNumber(date)
  const danishWeekDay = getDanishWeekDay(date)
  const weekNumberMatcher = `_U${weekNumber}`
  
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(NOON_CPH_MENU_LINK)
  
  const linkCollection = await page.$$eval('a', links => links.map(link => link.href))
  const [lunchLink] = linkCollection.filter(link => link.includes(weekNumberMatcher) && link.includes(danishWeekDay))

  return lunchLink
}

async function extractPageFromPdf (pdfFileBuffer, pageNumber) {
  const pdfDoc = await PDFDocument.load(pdfFileBuffer)
  const subDocument = await PDFDocument.create()
  const [copiedPage] = await subDocument.copyPages(pdfDoc, [pageNumber])
  subDocument.addPage(copiedPage)
  const pdfBytes = await subDocument.save()
  return pdfBytes
}

async function getFileBufferFromLink (lunchLink) {
  const fileBuffer = await axios.get(lunchLink, { responseType: 'arraybuffer' })
  return fileBuffer.data
}

async function uploadFileToSlack (fileName) {
  const form = new FormData()
  form.append('channels', process.env.SLACK_CHANNEL_ID)
  form.append('title', fileName)
  form.append('filetype', 'auto')
  form.append('file', fs.createReadStream(fileName))

  await axios.post(
    SLACK_FILE_UPLOAD_URL,
    form,
    {
      headers: {
        'Authorization': `Bearer ${process.env.SLACK_TOKEN}`,
        'Content-Type': 'multipart/form-data'
      }
    }
  )
}

async function convertPdfToPng (fileName) {
  const pdfImage = new PDFImage(fileName, {
    convertOptions: {
      '-background': 'white',
      '-alpha': 'remove',
      '-density': '300',
      '-quality': '100'
    }
  })
  
  const [pathToPng] = await pdfImage.convertFile()
  return pathToPng
}

async function main () {
  const today = new Date()

  log('🏁 starting browser...')
  const lunchLink = await getLunchLink(today)

  log('⬇️ getting pdf file from link...')
  const menuFileBuffer = await getFileBufferFromLink(lunchLink)

  log('💅 extracting page from pdf...')
  const singlePageMenuFileBuffer = await extractPageFromPdf(menuFileBuffer, getPageNumber(today))

  log('🗄 saving file...')
  const pdfFileName = `${today.toISOString().split('T')[0]}-menu.pdf`
  fs.writeFileSync(pdfFileName, singlePageMenuFileBuffer)

  let fileToBeUploadedToSlack = pdfFileName
  if (process.env.SHOULD_CONVERT_TO_IMAGE) {
    log('📸 converting pdf to png...')
    fileToBeUploadedToSlack = await convertPdfToPng(pdfFileName)
  }

  log('⬆️ uploading file to slack...')
  await uploadFileToSlack(fileToBeUploadedToSlack)
  log('🎉 file successfully uploaded')

  log('❌ removing file(s)...')
  fs.rmSync(pdfFileName)
  if (process.env.SHOULD_CONVERT_TO_IMAGE) fs.rmSync(fileToBeUploadedToSlack)

  process.exit(0)
}

main()
