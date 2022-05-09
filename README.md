# Noon CPH Slack Bot

This is a small program that gets the menu of the day from [Noon](https://www.nooncph.dk/) and posts it in a Slack channel.

## Usage

It should be fairly straight forward:

1. Get the code off of here, e.g. `$ git clone <this repo>`

2. Go into the directory with the code, e.g. `$ cd <path to this repo from step 1>`

3. Make sure that the environment variables are set, e.g. `$ vim .env` and then replicate something along the lines of:

   ```
   SLACK_TOKEN=xoxb-12345-12345-12345
   SLACK_CHANNEL_ID=C12345
   FULL_NOON_DAYS=monday,friday
   ```

   Note that the `FULL_NOON_DAYS` variable is comma delimited and that the days are in English. It is assumed that all other days are Green Noon days. Also, you can specify getting the menu in Danish instead of English by setting `LANGUAGE=da`.

4. Run `$ yarn start`, `$ npm run start`, or `$ node main.js`

5. Aaand you're done

## License

MIT
