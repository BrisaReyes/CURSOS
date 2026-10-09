const express = require("express");

const app = express();
app.use(express.json());
app.use(express.static("."));

const CURSO_URL =
"https://cursos-def.onrender.com/astrologia/index2.html";

const INICIO_URL =
"https://cursos-def.onrender.com/astrologia/index.html";

const ERROR_URL =
"https://cursos-5.onrender.com";

app.post("/api/crear-pago", async (req, res) => {
try {
const token = process.env.MP_ACCESS_TOKEN;
const precio = Number(process.env.MP_PRICE);

    if (!token || !Number.isFinite(precio) || precio <= 0) {
        return res.status(500).json({
            error: "Falta configurar el token o el precio."
        });
    }

    const respuesta = await fetch(
        "https://api.mercadopago.com/checkout/preferences",
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                items: [{
                    title: "Curso de Astrología ASTRO ROJO",
                    quantity: 1,
                    currency_id: "ARS",
                    unit_price: precio
                }],
                back_urls: {
                    success: CURSO_URL,
                    pending: INICIO_URL,
                    failure: ERROR_URL
                },
                auto_return: "approved"
            })
        }
    );

    const datos = await respuesta.json();

    if (!respuesta.ok || !datos.init_point) {
        console.error("Error al crear pago:", datos);
        return res.status(502).json({
            error: "Mercado Pago no pudo crear el pago."
        });
    }

    res.json({ init_point: datos.init_point });

} catch (error) {
    console.error(error);
    res.status(500).json({
        error: "Error interno al crear el pago."
    });
}

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log("ASTRO ROJO funcionando en puerto ${PORT}");
});
