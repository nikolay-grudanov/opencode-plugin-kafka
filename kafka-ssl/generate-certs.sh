#!/bin/bash
# Генерация SSL сертификатов для Kafka

set -e

SSL_DIR="$(dirname "$0")"
CA_CERT="$SSL_DIR/ca-cert"
CA_KEY="$SSL_DIR/ca-key"
DAYS_VALID=365
KEYSTORE="$SSL_DIR/kafka.keystore.jks"
TRUSTSTORE="$SSL_DIR/kafka.truststore.jks"

echo "=== Генерация SSL сертификатов для Kafka ==="

cd "$SSL_DIR"

# Создаём CA (Certificate Authority)
echo "[1/7] Создаём CA..."
openssl req -new -x509 -days $DAYS_VALID -keyout $CA_KEY -out $CA_CERT \
    -subj "/CN=localhost/O=KafkaCA/OU=Dev" \
    -passout pass:changeit \
    -nodes

# Генерируем keystore для Kafka broker
echo "[2/7] Генерируем keystore для broker..."
keytool -genkey -alias kafka-broker \
    -keystore $KEYSTORE \
    -keyalg RSA -keysize 2048 \
    -validity $DAYS_VALID \
    -storepass changeit \
    -keypass changeit \
    -dname "CN=localhost, O=Kafka, L=Moscow, C=RU" \
    -ext "SAN=dns:localhost,ip:127.0.0.1"

# Экспортируем CSR из keystore
echo "[3/7] Экспортируем CSR..."
keytool -certreq -alias kafka-broker \
    -keystore $KEYSTORE \
    -storepass changeit \
    -file kafka-cert-signing-request.csr \
    -keypass changeit

# Подписываем сертификат нашим CA
echo "[4/7] Подписываем сертификат..."
cat > ext.cnf << 'EOF'
[v3_ca]
subjectAltName = DNS:localhost, IP:127.0.0.1
EOF

openssl x509 -req -days $DAYS_VALID \
    -in kafka-cert-signing-request.csr \
    -CA $CA_CERT -CAkey $CA_KEY \
    -passin pass:changeit \
    -out kafka-broker-signed.crt \
    -CAcreateserial \
    -extfile ext.cnf -extensions v3_ca

# Импортируем CA в keystore
echo "[5/7] Импортируем CA в keystore..."
keytool -delete -alias ca -keystore $KEYSTORE -storepass changeit 2>/dev/null || true
keytool -importcert -alias ca \
    -file $CA_CERT \
    -keystore $KEYSTORE \
    -storepass changeit \
    -noprompt

# Импортируем подписанный сертификат в keystore
echo "[6/7] Импортируем подписанный сертификат в keystore..."
keytool -delete -alias kafka-broker -keystore $KEYSTORE -storepass changeit 2>/dev/null || true
keytool -importcert -alias kafka-broker \
    -file kafka-broker-signed.crt \
    -keystore $KEYSTORE \
    -storepass changeit \
    -keypass changeit \
    -noprompt

# Создаём truststore (доверяем только CA)
echo "[7/7] Создаём truststore..."
keytool -importcert -alias ca \
    -file $CA_CERT \
    -keystore $TRUSTSTORE \
    -storepass changeit \
    -noprompt

# Права на файлы
chmod 600 $SSL_DIR/*.jks $SSL_DIR/*.key $SSL_DIR/*.p12 2>/dev/null || true
chmod 644 $SSL_DIR/*.crt $SSL_DIR/*.csr $SSL_DIR/*.srl 2>/dev/null || true

echo ""
echo "=== SSL сертификаты созданы ==="
ls -la $SSL_DIR/
echo ""
echo "Пароли: changeit"
echo "Запуск: docker compose -f docker-compose.kafka.yml up -d"