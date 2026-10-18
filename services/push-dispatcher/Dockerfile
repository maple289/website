FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && mkdir /var/lib/push && chown 10001:10001 /var/lib/push && chmod 700 /var/lib/push
COPY dispatcher.py ./
USER 10001:10001
CMD ["python", "dispatcher.py"]
