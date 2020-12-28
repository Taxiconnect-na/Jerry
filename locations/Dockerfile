FROM node:latest

ADD . /app/
WORKDIR /app

RUN npm install pm2 -g
RUN npm install
RUN npm audit fix

EXPOSE 9097
EXPOSE 9090
EXPOSE 9091
EXPOSE 8989
EXPOSE 9094
EXPOSE 9696
EXPOSE 9494
EXPOSE 9093

CMD [ "pm2-runtime", "ecosystem.config.js" ]