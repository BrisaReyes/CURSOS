const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.use(express.json());


const BASE_URL = (
    process.env.BASE_URL || "https://cursos-5.onrender.com"
).replace(/\/$/, "");

const CURSO_URL = `${BASE_URL}/astrologia/index.html`;
const INICIO_URL = `${BASE_URL}/`;
const COOKIE_NAME = "astro_rojo_user";


const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: { rejectUnauthorized: false }
});

function obtenerUsuario(req) {
const cookies = req.headers.cookie || "";
const prefijo = `${COOKIE_NAME}=`;
const cookie = cookies
.split(";")
.map(c => c.trim())
.find(c => c.startsWith(prefijo));

return cookie ? cookie.slice(prefijo.length) : null;

}

function crearUsuario(res) {
const id = crypto.randomUUID();

res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`
);

return id;

}

async function inicializarBaseDatos() {
await pool.query("CREATE TABLE IF NOT EXISTS accesos_curso ( usuario_id TEXT PRIMARY KEY, vence_en TIMESTAMPTZ NOT NULL )");

await pool.query(`
    CREATE TABLE IF NOT EXISTS pagos_curso (
        pago_id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        aprobado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
`);

}

async function verificarPago(paymentId) {
const token = process.env.MP_ACCESS_TOKEN;

if (!token || !paymentId) {
    throw new Error("Falta el token o el identificador del pago.");
}

const respuesta = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
        headers: {
            Authorization: `Bearer ${token}`
        }
    }
);

const pago = await respuesta.json();

if (!respuesta.ok) {
    console.error("Error verificando pago:", pago);
    throw new Error("No se pudo verificar el pago.");
}

if (pago.status !== "approved" || !pago.external_reference) {
    return false;
}

const cliente = await pool.connect();

try {
    await cliente.query("BEGIN");

    const insertado = await cliente.query(
        `INSERT INTO pagos_curso (pago_id, usuario_id)
         VALUES ($1, $2)
         ON CONFLICT (pago_id) DO NOTHING
         RETURNING pago_id`,
        [String(pago.id), pago.external_reference]
    );

    if (insertado.rowCount > 0) {
        await cliente.query(
            `INSERT INTO accesos_curso (usuario_id, vence_en)
             VALUES ($1, NOW() + INTERVAL '30 days')
             ON CONFLICT (usuario_id)
             DO UPDATE SET vence_en =
                GREATEST(accesos_curso.vence_en, NOW())
                + INTERVAL '30 days'`,
            [pago.external_reference]
        );
    }

    await cliente.query("COMMIT");
    return pago.external_reference;
} catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
} finally {
    cliente.release();
}

}

app.post("/api/crear-pago", async (req, res) => {
try {
const token = process.env.MP_ACCESS_TOKEN;
const precio = Number(process.env.MP_PRICE);

    if (
        !token ||
        !Number.isFinite(precio) ||
        precio <= 0
    ) {
        return res.status(500).json({
            error: "Falta configurar el token o el precio."
        });
    }

    const usuarioId = obtenerUsuario(req) || crearUsuario(res);

    const respuesta = await fetch(
        "https://api.mercadopago.com/checkout/preferences",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                items: [{
                    title: "Curso de Astrología ASTRO ROJO",
                    quantity: 1,
                    currency_id: "ARS",
                    unit_price: precio
                }],
                external_reference: usuarioId,
                notification_url: `${BASE_URL}/api/mp-webhook`,
                
back_urls: {
    success: `${BASE_URL}/api/pago-aprobado`,
    pending: `${BASE_URL}/`,
    failure: `${BASE_URL}/`
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
    console.error("Error creando pago:", error);
    res.status(500).json({
        error: "Error interno al crear el pago."
    });
}

});


app.get("/api/pago-aprobado", async (req, res) => {
    try {
        const paymentId =
            req.query.payment_id ||
            req.query.collection_id;

        if (!paymentId) {
            return res.redirect(`${INICIO_URL}?pago=pendiente`);
        }

        // Mercado Pago confirma el pago y devuelve
        // el usuario asociado a ese pago.
        const resultado = await verificarPago(String(paymentId));

        if (!resultado || typeof resultado !== "string") {
            return res.redirect(`${INICIO_URL}?pago=pendiente`);
        }

        // Recuperamos la identidad aunque la cookie
        // no haya llegado en la vuelta de Mercado Pago.
        res.setHeader(
            "Set-Cookie",
            `${COOKIE_NAME}=${encodeURIComponent(resultado)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`
        );

        // El acceso se comprueba en PostgreSQL
        // al intentar entrar al curso.
        return res.redirect(CURSO_URL);

    } catch (error) {
        console.error("Error al confirmar pago:", error);

        return res.redirect(`${INICIO_URL}?pago=pendiente`);
    }
});


app.post("/api/mp-webhook", async (req, res) => {
res.sendStatus(200);

try {
    const tipo = req.query.type || req.body?.type;
    const paymentId =
        req.query["data.id"] ||
        req.body?.data?.id;

    if (tipo === "payment" && paymentId) {
        await verificarPago(String(paymentId));
    }
} catch (error) {
    console.error("Error en webhook:", error);
}

});

app.get("/api/mi-acceso", async (req, res) => {
try {
const usuarioId = obtenerUsuario(req);

    if (!usuarioId) {
        return res.json({
            autorizado: false
        });
    }

    const resultado = await pool.query(
        `SELECT vence_en > NOW() AS vigente, vence_en
         FROM accesos_curso
         WHERE usuario_id = $1`,
        [usuarioId]
    );

    if (!resultado.rows.length) {
        return res.json({
            autorizado: false
        });
    }

    res.json({
        autorizado: resultado.rows[0].vigente,
        vence_en: resultado.rows[0].vigente
            ? resultado.rows[0].vence_en
            : null
    });
} catch (error) {
    console.error("Error consultando acceso:", error);
    res.status(500).json({
        error: "No se pudo consultar el acceso."
    });
}

});

app.use(async (req, res, next) => {
const rutasProtegidas = [
"/astrologia",
"/astrologia/",
"/astrologia/index.html"
];

if (!rutasProtegidas.includes(req.path)) {
    return next();
}

try {
    const usuarioId = obtenerUsuario(req);

    if (!usuarioId) {
        return res.redirect(INICIO_URL);
    }

    const resultado = await pool.query(
        `SELECT 1
         FROM accesos_curso
         WHERE usuario_id = $1
         AND vence_en > NOW()`,
        [usuarioId]
    );

    if (!resultado.rowCount) {
        return res.redirect(INICIO_URL);
    }

    next();
} catch (error) {
    console.error("Error protegiendo curso:", error);
    res.status(503).send(
        "No se pudo comprobar el acceso. Intentá nuevamente más tarde."
    );
}

});

app.use(express.static("."));

const PORT = process.env.PORT || 3000;

async function iniciarServidor() {
try {
await inicializarBaseDatos();

    app.listen(PORT, () => {
        console.log(`ASTRO ROJO funcionando en puerto ${PORT}`);
    });
} catch (error) {
    console.error("No se pudo iniciar el servidor:", error);
    process.exit(1);
}

}

iniciarServidor();
