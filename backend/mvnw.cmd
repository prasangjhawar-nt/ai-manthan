@echo off
@REM Simple wrapper: calls the bundled Maven in .mvn\apache-maven-3.9.9
setlocal
set DIR=%~dp0
set MAVEN_HOME=%DIR%.mvn\apache-maven-3.9.9
call "%MAVEN_HOME%\bin\mvn.cmd" %*
exit /b %ERRORLEVEL%
