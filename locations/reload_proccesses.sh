#!/bin/bash

while /usr/bin/true
do
   pm2 reload all --update-env
   sleep 900
done