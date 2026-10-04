# Stage 1: Build application and bundle frontend
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
COPY frontend ./src/main/resources/static
RUN mvn clean package -DskipTests

# Stage 2: Run the packaged jar
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/dsa-engine-1.0.0.jar app.jar
EXPOSE 8080

CMD ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
