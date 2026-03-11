FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY . ./
RUN set -e; \
    PROJ="$(ls -1 *.csproj | head -n 1)"; \
    dotnet restore "$PROJ"; \
    dotnet publish "$PROJ" -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish ./

EXPOSE 8080
ENV ASPNETCORE_URLS=http://0.0.0.0:8080

RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'APP_BASE="$(ls -1 *.runtimeconfig.json | head -n 1 | sed "s/\\.runtimeconfig\\.json$//")"' \
  'exec dotnet "${APP_BASE}.dll"' \
  > /entrypoint.sh \
  && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
