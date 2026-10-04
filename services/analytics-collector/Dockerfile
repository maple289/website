FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir requests==2.32.5
COPY collector.py system_load.py ./
CMD ["python", "collector.py"]
