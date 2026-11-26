FROM qgis/qgis-server:ltr-noble
WORKDIR /app
COPY app.py .
ENV PYTHONUNBUFFERED=1
ENV QT_QPA_PLATFORM=offscreen
ENV GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR
ENV PYTHONPATH=/usr/share/qgis/python:/usr/share/qgis/python/plugins
EXPOSE 8080
VOLUME ["/io/data"]
CMD ["/usr/bin/python3","/app/app.py"]
