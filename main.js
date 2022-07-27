require('dotenv').config()
const weekDays = require('i18n-week-days')
const axios = require('axios')
const { WebClient } = require('@slack/web-api')
const { PDFDocument } = require('pdf-lib')
const { PDFImage } = require('pdf-image')
const cheerio = require('cheerio')
const fs = require('fs')

const NOON_CPH_MENU_LINK = 'https://www.nooncph.dk/ugens-menuer'
const web = new WebClient(process.env.SLACK_TOKEN)

function log (message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function getPageNumbers (date) {
  const weekDayInHumanFormat = date.toLocaleString('en-us', {  weekday: 'long' }).toLowerCase()
  const isFullNoon = process.env.FULL_NOON_DAYS.split(',').includes(weekDayInHumanFormat)
  const isGreenNoon = process.env.GREEN_NOON_DAYS.split(',').includes(weekDayInHumanFormat)
  const isDanishLanguageSpecified = process.env.LANGUAGE === 'da'

  const result = []
  if (isGreenNoon && isDanishLanguageSpecified) result.push(0)
  if (isGreenNoon && !isDanishLanguageSpecified) result.push(1)
  if (isFullNoon && isDanishLanguageSpecified) result.push(2)
  if (isFullNoon && !isDanishLanguageSpecified) result.push(3)
  return result
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
  const danishWeekDay = getDanishWeekDay(date).substring(0, 3)
  const weekNumberMatcher = `_u${weekNumber}`
  
  const { data } = await axios.get(NOON_CPH_MENU_LINK)
  const $ = cheerio.load(data)
  const linkCollection = $('a').map((_, linkElement) => $(linkElement).attr('href')).get()
  const [lunchLink] = linkCollection.filter(link => {
    const linkInAllLowerCase = link.toLowerCase()
    return linkInAllLowerCase.includes(weekNumberMatcher) && linkInAllLowerCase.includes(danishWeekDay)
  })

  if (!lunchLink) throw new Error(`Could not find lunch link for ${danishWeekDay} week ${weekNumber}:${linkCollection.join('\n')}`)

  return lunchLink
}

async function extractPagesFromPdf (pdfFileBuffer, pageNumbers) {
  const pdfDoc = await PDFDocument.load(pdfFileBuffer)
  const subDocument = await PDFDocument.create()
  const copiedPages = await subDocument.copyPages(pdfDoc, pageNumbers)
  for (const page of copiedPages) {
    await subDocument.addPage(page)
  }
  const pdfBytes = await subDocument.save()
  return pdfBytes
}

async function getFileBufferFromLink (lunchLink) {
  const fileBuffer = await axios.get(lunchLink, { responseType: 'arraybuffer' })
  return fileBuffer.data
}

async function uploadFileToSlack (filename) {
  const { file: { permalink } } = await web.files.upload({
    filename,
    file: fs.createReadStream(filename)
  })
  return permalink
}

async function sendMessageToSlack (message) {
  const result = await web.chat.postMessage({
    text: message,
    channel: process.env.SLACK_CHANNEL_ID
  })
  return result
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
  
  const pathToPngs = await pdfImage.convertFile()
  return pathToPngs
}

async function main () {
  const today = new Date()

  log('🏁 getting lunch link...')
  const lunchLink = await getLunchLink(today)

  log('⬇️ getting pdf file from link...')
  const menuFileBuffer = await getFileBufferFromLink(lunchLink)

  log('💅 extracting page(s) from pdf...')
  const extractedMenuFileBuffer = await extractPagesFromPdf(menuFileBuffer, getPageNumbers(today))

  log('🗄 saving file(s)...')
  const pdfFileName = `${today.toISOString().split('T')[0]}-menu.pdf`
  fs.writeFileSync(pdfFileName, extractedMenuFileBuffer)

  let filesToBeUploadedToSlack = [pdfFileName]
  if (process.env.SHOULD_CONVERT_TO_IMAGE) {
    log('📸 converting pdf to png(s)...')
    const pathToPngs = await convertPdfToPng(pdfFileName)
    filesToBeUploadedToSlack = pathToPngs
  }

  log('⬆️ uploading file(s) to slack...')
  const permalinks = await Promise.all([
    ...filesToBeUploadedToSlack.map(fileName => uploadFileToSlack(fileName))
  ])
  log('🎉 file(s) successfully uploaded')

  log('📝 creating message...')
  const message = permalinks.map(permalink => `<${permalink}| >`).join('')
  await sendMessageToSlack(message)

  log('❌ removing file(s)...')
  await Promise.all(
    [...new Set([pdfFileName, ...filesToBeUploadedToSlack])].map(fileName => fs.promises.rm(fileName))
  )
}

main()
