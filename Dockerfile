FROM ghcr.io/crytic/echidna/echidna:latest

WORKDIR /src

RUN apt update \
    && apt install nodejs -y \
    && apt install npm -y \
    && npm i -g npx -y

CMD [ "/bin/bash", "echidna.sh" ]
