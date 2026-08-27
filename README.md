# Agro-Plex

**Plan de siembra y fertilización por programación lineal.**

Aplicación web didáctica que resuelve, con el método símplex de dos fases y directamente en el
navegador, el problema de decidir *qué sembrar y con qué fertilizar* en un predio: cuántas hectáreas
dedicar a cada cultivo y cuántas toneladas comprar de cada marca y fórmula de fertilizante, para
maximizar la utilidad neta del ciclo sujeta a la tierra, el agua de riego, el presupuesto, las
existencias del proveedor y los requerimientos nutricionales de cada cultivo.

**Sitio publicado:** https://gusorh.github.io/agro-plex/

Material del proyecto educativo innovador para las experiencias educativas **Matemáticas**,
**Nutrición Vegetal** y **Diagnóstico de Sistemas Productivos** del programa de Ingeniero Agrónomo,
Facultad de Ciencias Agrícolas, Universidad Veracruzana.

---

## Qué contiene

| Pestaña | Para qué sirve |
| --- | --- |
| **Predio y recursos** | Superficie total, volumen de riego, presupuesto y las reglas opcionales (tope de sobrefertilización, nitrógeno orgánico mínimo, existencias). Incluye el mapa de la parcela. |
| **Cultivos** | Ocho cultivos precargados con margen bruto, lámina de riego, requerimientos de N, P₂O₅ y K₂O en t/ha, y áreas mínima y máxima. Todo editable. |
| **Fertilizantes** | Nueve productos con marca, grado, aporte por tonelada, precio y existencia, más el costo efectivo por tonelada de nutriente. |
| **Asociaciones** | Reglas del tipo *xₐ ≤ k·x_b* para modelar milpa, intercalado o compromisos de mercado. |
| **Formulación matemática** | El modelo en notación general: conjuntos, parámetros, once ecuaciones numeradas con su explicación didáctica, forma matricial y estándar, y los cuatro supuestos de la programación lineal. |
| **Modelo con tus datos** | Las mismas restricciones desarrolladas con los números capturados, marcando cuáles quedaron activas. |
| **Solución** | Plan óptimo, mapa del predio, gráficas, balance de nutrientes, análisis de sensibilidad con precios sombra y comparación de escenarios. |
| **Ficha y reporte** | Datos del técnico, del productor y del predio, y generación de un reporte imprimible en PDF con interpretación automática de los resultados. |

## El modelo

Variables de decisión: `xᵢ` hectáreas del cultivo *i*, `yⱼ` toneladas del fertilizante *j*
(o `yᵢⱼ` en el modo de balance por cultivo).

```
máx Z = ∑ᵢ uᵢ xᵢ − ∑ⱼ cⱼ yⱼ

sujeto a:
  ∑ᵢ xᵢ ≤ S                          superficie del predio
  ∑ᵢ aᵢ xᵢ ≤ A                       agua de riego del ciclo
  ∑ⱼ pⱼₖ yⱼ ≥ ∑ᵢ rᵢₖ xᵢ    ∀ k ∈ K   balance de N, P₂O₅ y K₂O
  ∑ⱼ pⱼₖ yⱼ ≤ (1+τ) ∑ᵢ rᵢₖ xᵢ ∀ k    tope de sobrefertilización (opcional)
  ∑ⱼ∈O pⱼN yⱼ ≥ β ∑ᵢ rᵢN xᵢ          nitrógeno de origen orgánico (opcional)
  ∑ⱼ cⱼ yⱼ ≤ B                       presupuesto de fertilizante
  yⱼ ≤ Dⱼ                  ∀ j ∈ J   existencias del proveedor
  mᵢ ≤ xᵢ ≤ Mᵢ             ∀ i ∈ I   áreas mínima y máxima
  xₐ − kₐᵦ x_b ≤ 0        ∀ (a,b)    asociación entre cultivos
  xᵢ, yⱼ ≥ 0
```

Todas las unidades de fertilizante están en toneladas; los requerimientos, en toneladas de nutriente
por hectárea (0.16 t/ha = 160 kg/ha). El símplex está implementado en `src/App.jsx` y no depende de
ninguna librería de optimización externa.

## Adaptar los datos

Los cultivos, fertilizantes y reglas precargados son ilustrativos, calibrados para condiciones de la
zona centro de Veracruz. Se editan desde la propia interfaz sin tocar código; para cambiar los
valores con los que arranca la aplicación, modifica las constantes `CULTIVOS_0`, `FERTS_0`,
`ASOCS_0` y `PAR_0` al inicio de `src/App.jsx`.

El modelo **no descuenta el nutriente que ya aporta el suelo**, no considera eficiencias de
aplicación ni pérdidas por lixiviación o volatilización, y toma precios y rendimientos como datos
ciertos. Las dosis que arroja deben contrastarse contra un análisis de suelo vigente y el criterio
del responsable técnico.

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

## Ayuda dentro de la app

La pestaña **Ayuda** del menú principal muestra este mismo contenido (qué contiene cada pestaña, el
modelo, cómo adaptar los datos, créditos y licencia) para que el usuario pueda consultarlo sin salir
de la aplicación.

## Créditos

Cuerpo académico **Biotecnología, Biodiversidad y Manejo de los Recursos Naturales (UVA-CA-220)**
Facultad de Ciencias Agrícolas · Universidad Veracruzana

- Dr. Gustavo Ortiz Hernández — gustortiz@uv.mx
- Dra. Luz Amelia Sánchez Landero — lusanchez@uv.mx
- Dr. Gustavo C. Ortiz Ceballos — gusortiz@uv.mx

## Licencia

Código bajo licencia MIT (ver `LICENSE`). El logotipo y la identidad de la Facultad de Ciencias
Agrícolas y de la Universidad Veracruzana son propiedad de la institución y no quedan cubiertos por
esa licencia.
