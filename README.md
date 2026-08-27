# Agro-Plex — Plan de fertilización (programación lineal)

Aplicación React que resuelve, con un símplex de dos fases implementado en el
propio cliente, el plan óptimo de siembra y fertilización de un predio dado
su superficie, agua de riego y presupuesto disponibles.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build
```

Genera el sitio estático en `dist/`.

## Despliegue

Cada push a `main` dispara el workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que compila
el proyecto y lo publica en GitHub Pages:

https://gusorh.github.io/agro-plex/
