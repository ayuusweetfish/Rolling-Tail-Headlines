openssl genrsa -out fox_root_ca.key 4096
openssl req -x509 -new -nodes -key fox_root_ca.key -sha256 -days 1024 -out fox_root_ca.pem -subj "/CN=FoxLocalCA"
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=paint.fox.ayu.land"
openssl x509 -req -in server.csr -CA fox_root_ca.pem -CAkey fox_root_ca.key -CAcreateserial -out server.crt -days 365 -sha256 -extfile server.ext
