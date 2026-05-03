FROM node:18-alpine

WORKDIR /retrobot

RUN apk add --no-cache git python3 xz-dev make g++
RUN npm install --global yarn cross-env forever

COPY . .

RUN yarn install && yarn cache clean

CMD ["yarn", "start"]
