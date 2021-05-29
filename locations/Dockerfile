FROM node:latest

ADD . /app/
WORKDIR /app
RUN rm .env
#Production
RUN mv .env_live .env
#Development
#RUN mv .env_dev .env

RUN npm install yarn -g --force
RUN yarn global add pm2
RUN pm2 install pm2-logrotate
#RUN pm2 install @easynvest/pm2-logstash
RUN pm2 set pm2-logrotate:max_size 50Mb
#RUN pm2 set @easynvest/pm2-logstash:logstash_host 'taxiconnectna.com'
#RUN pm2 set @easynvest/pm2-logstash:logstash_port 9994
#RUN pm2 set @easynvest/pm2-logstash:logstash_type 'tcp'
RUN yarn install
#nohup watch -n 900 -x pm2 reload all &

#EXPOSE 9097
#EXPOSE 9090
#EXPOSE 9091
#EXPOSE 9797
#EXPOSE 9094
EXPOSE 9696
#EXPOSE 9494
#EXPOSE 9093

CMD [ "pm2-runtime", "ecosystem.config.js" ]