#!/bin/bash

while /usr/bin/true
do
   pm2 flush
   pm2 reload all --update-env
   echo 'STABILIZER - LOOP RUN'
   sleep 900
done