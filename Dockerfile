FROM qgis/qgis:3.40
WORKDIR /app
COPY requirements.txt .
RUN python3 -m pip install --break-system-packages -r requirements.txt
COPY app.py .
RUN mkdir -p /data/terrain-outputs
ENV PYTHONUNBUFFERED=1 TERRAIN_OUTPUT_DIR=/data/terrain-outputs
VOLUME ["/data/terrain-outputs"]
EXPOSE 8080
CMD ["/usr/bin/python3","app.py"]
