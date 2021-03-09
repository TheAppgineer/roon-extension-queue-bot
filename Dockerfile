# Use an official node runtime as a parent image
FROM node:12.16.3-alpine

COPY queue-bot.js package.json LICENSE /home/node/

WORKDIR /home/node

RUN apk add --no-cache git && npm install && apk del git

USER node

CMD [ "node", "." ]
