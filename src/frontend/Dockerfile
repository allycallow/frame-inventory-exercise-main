FROM node:22-alpine
WORKDIR /app/src/frontend
COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm install
COPY src/frontend/ ./
COPY design-system/tokens.css /app/design-system/
COPY design-system/fonts/ /app/design-system/fonts/
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
