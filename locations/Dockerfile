FROM node:latest

ADD . /app/
WORKDIR /app

RUN npm install yarn -g --force
RUN yarn global add pm2
RUN yarn global add pm2-logrotate
RUN pm2 set pm2-logrotate:max_size 500Mb
RUN yarn install

EXPOSE 9097
EXPOSE 9090
EXPOSE 9091
EXPOSE 8989
EXPOSE 9094
EXPOSE 9696
EXPOSE 9494
EXPOSE 9093

CMD [ "pm2-runtime", "ecosystem.config.js" ]