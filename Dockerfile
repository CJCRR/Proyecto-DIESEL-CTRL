# Imagen base ligera de Node
FROM node:20-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar package.json y package-lock si existe
COPY package*.json ./

# Instalar dependencias en modo producción
RUN npm install --only=production

# Copiar el resto del código
COPY . .

# Exponer el puerto por defecto de la app
EXPOSE 3000

# Variables de entorno razonables por defecto dentro del contenedor
ENV NODE_ENV=production \
    PORT=3000

# Comando de arranque
CMD ["npm", "start"]
