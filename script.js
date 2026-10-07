
// =========================================================
// TAROT ROJO · ASTRO ROJO — CURSOS
// =========================================================

document.addEventListener("DOMContentLoaded", () => {

    const tarjetas = document.querySelectorAll(".card");

    tarjetas.forEach((tarjeta, index) => {

        tarjeta.style.opacity = "0";
        tarjeta.style.transform = "translateY(20px)";

        setTimeout(() => {
            tarjeta.style.transition =
                "opacity 0.6s ease, transform 0.6s ease";

            tarjeta.style.opacity = "1";
            tarjeta.style.transform = "translateY(0)";
        }, index * 150);

    });

});

