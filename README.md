# ReestructuraIA

Asistente de **refinanciamiento y reprogramación de créditos** con IA para Cajas Municipales de Ahorro y Crédito (CMAC). Proyecto académico del eje **Recuperaciones · 4.3 Refinanciamiento y reprogramación de deudas**.

## Qué resuelve
Hoy el asesor evalúa cada caso en Excel y redacta a mano el informe para el comité. ReestructuraIA:

1. **Diagnostica** al cliente: historial de pagos, clasificación SBS, puntaje de riesgo (0–100).
2. **Simula tres escenarios** con el sistema francés: mantener condiciones, reprogramación (periodo de gracia) y refinanciamiento (nuevo plazo y tasa).
3. **Verifica la política**: la cuota no supera el 70% del excedente, el atraso máximo para reprogramar es de 30 días, la clasificación debe ser Normal o CPP y hay un límite de reprogramaciones previas.
4. **Usa IA (Google Gemini)** para recomendar, redactar el informe técnico del comité y el mensaje de WhatsApp para el cliente. La IA no calcula: los números vienen del motor determinista.
5. **Gestiona el flujo**: borrador → comité → aprobada o rechazada → seguimiento de las 3 primeras cuotas.

## Arquitectura
| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript (módulos ES), sin framework |
| Backend | Node.js 20 + Express (desplegado en **Render**) |
| Base de datos | **Supabase** (PostgreSQL + Row Level Security) |
| IA | **Google Gemini** (`gemini-2.5-flash`) vía API REST, con respaldo por reglas |

```
Navegador ──► Express (Render) ──► Supabase (clientes, créditos, solicitudes, seguimiento)
                    └──────────► Gemini API (recomendación + informe + mensaje)
```

## Ejecutar localmente
```bash
npm install
cp .env.example .env   # completar claves
node --env-file=.env server.js
npm test               # pruebas del motor financiero
```
Sin conexión: `MOCK_DB=1 node server.js` usa datos de prueba en memoria.

## Datos
Todos los clientes y créditos son **ficticios**. Las reglas de política son referenciales para la demo y deben ajustarse al manual de créditos de cada caja y a la normativa SBS vigente (Res. SBS N.º 11356-2008 y modificatorias).
