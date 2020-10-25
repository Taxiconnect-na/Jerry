FROM node:latest

ADD . /app/
WORKDIR /app

RUN npm install pm2 -g
RUN npm install
RUN npm audit fix
EXPOSE 9090

CMD ["pm2-runtime", "ecosystem.config.js"]