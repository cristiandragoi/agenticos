FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/tools
RUN npm install --ignore-scripts --no-audit --no-fund agent-browser@0.38.2 playwright@1.61.1
RUN chmod 755 /opt/tools/node_modules/agent-browser/bin/agent-browser-linux-x64
COPY benchmark.mjs /opt/benchmark.mjs
USER 65534:65534
ENV HOME=/tmp
ENTRYPOINT ["node", "/opt/benchmark.mjs"]
