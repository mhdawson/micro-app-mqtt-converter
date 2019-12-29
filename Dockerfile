From node:12.14.0-alpine
WORKDIR /home/node
COPY package*.json ./

RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "lib/server.js"]
