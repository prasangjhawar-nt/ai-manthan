# Local dev launcher: Postgres at :5433 (to avoid colliding with airflow at :5432),
# WireMock at :8089, backend at :8080.
#
# Prereq: `docker run -d --name ef-pg -e POSTGRES_DB=app -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -p 5433:5432 postgres:18`
#         `docker run -d --name ef-wiremock -p 8089:8080 wiremock/wiremock:latest`

$env:SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5433/app"
$env:SPRING_DATASOURCE_USERNAME="app"
$env:SPRING_DATASOURCE_PASSWORD="app"
$env:EXTERNAL_SERVICE_URL="http://localhost:8089"
# Force JVM default TZ to UTC so Postgres 18 accepts the JDBC handshake
# (otherwise driver sends host TZ like "Asia/Calcutta" which PG 18 rejects).
$env:MAVEN_OPTS="-Duser.timezone=UTC"
$env:SPRING_BOOT_RUN_JVMARGUMENTS="-Duser.timezone=UTC"
.\mvnw.cmd spring-boot:run
