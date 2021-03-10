FROM phusion/baseimage:master
# Set correct environment variables.
ENV HOME /root

# Regenerate SSH host keys. baseimage-docker does not contain any, so you
# have to do that yourself. You may also comment out this instruction; the
# init system will auto-generate one during boot.
RUN /etc/my_init.d/00_regen_ssh_host_keys.sh

# Use baseimage-docker's init system.
CMD ["/sbin/my_init"]

RUN apt-get update
RUN apt-get -y install openjdk-8-jdk
RUN apt-get -y install wget

# Clean up APT when done.
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*


# Get latest photon master from github
# RUN git clone https://github.com/komoot/photon.git /photon

RUN mkdir /photon
WORKDIR /photon

# Expose Photon Webservice
EXPOSE 2322

# Expose ES
EXPOSE 9200

# Download photon release 0.2.2
RUN wget http://photon.komoot.de/data/photon-0.2.2.jar

# VOLUME /photon/photon_data
# RUN mvn clean package
# RUN java -jar target/photon-0.2.3-SNAPSHOT.jar

CMD java -jar photon-0.2.2.jar  -nominatim-import -host $NOMINATIM_PORT_5432_TCP_ADDR -port $NOMINATIM_PORT_5432_TCP_PORT -languages de