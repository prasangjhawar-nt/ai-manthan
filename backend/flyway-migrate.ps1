# Run Flyway migrations directly against the local Postgres on :5433.
.\.mvn\apache-maven-3.9.9\bin\mvn.cmd `
  -q `
  org.flywaydb:flyway-maven-plugin:12.4.0:migrate `
  "-Dflyway.url=jdbc:postgresql://localhost:5433/app" `
  "-Dflyway.user=app" `
  "-Dflyway.password=app" `
  "-Dflyway.locations=filesystem:src/main/resources/db/migration"
