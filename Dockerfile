FROM node:latest

ADD . /app/
WORKDIR /app
RUN rm .env
#Production
RUN mv .env_live .env
#Development
#RUN mv .env_dev .env

RUN wget https://s3.amazonaws.com/rds-downloads/rds-combined-ca-bundle.pem
RUN chmod 400 rds-combined-ca-bundle.pem

#Get the instance private IP and save it
RUN export INSTANCE_PRIVATE_IP=$(curl "http://169.254.169.254/latest/meta-data/local-ipv4")
RUN echo $INSTANCE_PRIVATE_IP
#Get the instance public IP and save it
RUN export INSTANCE_PUBLIC_IP=$(curl "http://169.254.169.254/latest/meta-data/public-ipv4")
RUN echo $INSTANCE_PUBLIC_IP
#---

RUN npm install yarn -g --force
RUN yarn global add pm2
RUN pm2 install pm2-logrotate
RUN pm2 set pm2-logrotate:max_size 50Mb
RUN yarn install
RUN pm2 startup

EXPOSE 9097
EXPOSE 9090
EXPOSE 9091
EXPOSE 9797
EXPOSE 9094
EXPOSE 9696
EXPOSE 9494
EXPOSE 9093

CMD [ "pm2-runtime", "ecosystem.config.js" ]