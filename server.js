require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || "iapos_dp_secret_2025";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const cors = require("cors");
app.use(
  cors({
    origin: [
      "https://consultas.diapreventivoiapos.com",
      "https://cierre.diapreventivoiapos.com",
      "https://seguimiento.diapreventivoiapos.com",
      "https://prestadores.diapreventivoiapos.com",
      "https://enfermeria.diapreventivoiapos.com",
      "https://odontologia.diapreventivoiapos.com",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── SOLICITAR ACCESO ──
app.post("/solicitar-acceso", async (req, res) => {
  if (req.body.tipo === "prestador_institucional") {
    return solicitarAccesoPrestador(req, res);
  }

  try {
    const {
      dni,
      apellido,
      nombre,
      fecha_nacimiento,
      profesion,
      universidad,
      matricula,
      telefono,
      email,
      prestador_id,
    } = req.body;

    const sinMatricula = ["enfermera", "preventivista"];
    if (
      !dni ||
      !apellido ||
      !nombre ||
      !profesion ||
      !email ||
      (!matricula && !sinMatricula.includes(profesion))
    ) {
      return res.json({
        success: false,
        message: "Completá todos los campos obligatorios.",
      });
    }

    const dniNormalizado = dni.toString().replace(/^[a-zA-Z]+/, '').trim();
    const { data: existe } = await supabase
      .from("profesionales")
      .select("id, activo")
      .eq('dni', dniNormalizado)
      .single();

    if (existe) {
      if (existe.activo)
        return res.json({
          success: false,
          message: "Ya tenés acceso al sistema. Usá tu usuario y contraseña.",
        });
      return res.json({
        success: false,
        message: "Tu solicitud ya fue recibida y está pendiente de aprobación.",
      });
    }

    const { error } = await supabase.from("profesionales").insert({
      dni,
      apellido,
      nombre,
      fecha_nacimiento,
      profesion,
      universidad,
      matricula,
      telefono,
      email,
      prestador_id,
      activo: false,
      fecha_solicitud: new Date().toISOString(),
    });

    if (error) {
      console.error("Error Supabase:", error);
      return res.json({
        success: false,
        message: "Error al registrar la solicitud.",
      });
    }

    console.log(
      `✅ Nueva solicitud de acceso: ${nombre} ${apellido} (${profesion})`,
    );
    res.json({
      success: true,
      message:
        "Solicitud enviada correctamente. Recibirás tus credenciales por email una vez aprobada.",
    });
  } catch (error) {
    console.error("Error en /solicitar-acceso:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

async function solicitarAccesoPrestador(req, res) {
  try {
    const d = req.body;

    // Verificar si ya existe
    const { data: existe } = await supabase
      .from("prestadores_institucionales")
      .select("id, activo")
      .eq("cuit", d.cuit)
      .single();

    if (existe) {
      if (existe.activo)
        return res.json({
          success: false,
          message: "Este prestador ya tiene acceso al sistema.",
        });
      return res.json({
        success: false,
        message: "La solicitud ya fue recibida y está pendiente de aprobación.",
      });
    }

    const { error } = await supabase
      .from("prestadores_institucionales")
      .insert({
        nombre_institucion: d.nombre_institucion,
        cuit: d.cuit,
        telefono: d.telefono,
        mail: d.mail,
        direccion: d.direccion,
        localidad: d.localidad,
        provincia: d.provincia,
        nombre_responsable: d.nombre_responsable,
        dni_responsable: d.dni_responsable,
        matricula_responsable: d.matricula_responsable,
        telefono_responsable: d.telefono_responsable,
        mail_responsable: d.mail_responsable,
        especialidad: d.profesion,
        activo: false,
        fecha_solicitud: new Date().toISOString(),
      });

    if (error)
      return res.json({
        success: false,
        message: "Error al registrar la solicitud.",
      });

    console.log(`✅ Nueva solicitud prestador: ${d.nombre_institucion}`);
    res.json({
      success: true,
      message:
        "Solicitud enviada. Recibirás tus credenciales una vez aprobada.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
}
// ── LOGIN ──
app.post("/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;

    // Buscar primero en profesionales
    let profesional = null;
    let esPrestador = false;

    const { data: prof } = await supabase
      .from("profesionales")
      .select("*")
      .eq("usuario", usuario)
      .eq("activo", true)
      .single();

    if (prof) {
      profesional = prof;
    } else {
      // Buscar en prestadores_institucionales
      const { data: prest } = await supabase
        .from("prestadores_institucionales")
        .select("*")
        .eq("usuario", usuario)
        .eq("activo", true)
        .single();

      if (prest) {
        profesional = prest;
        esPrestador = true;
      }
    }

    if (!profesional) {
      return res.json({
        success: false,
        message: "Usuario o contraseña incorrectos.",
      });
    }

    const passwordOk = await bcrypt.compare(
      password,
      profesional.password_hash,
    );
    if (!passwordOk) {
      return res.json({
        success: false,
        message: "Usuario o contraseña incorrectos.",
      });
    }

    const token = jwt.sign(
      {
        id: profesional.id,
        usuario: profesional.usuario,
        nombre: esPrestador
          ? profesional.nombre_institucion
          : `${profesional.profesion === "bioquimico" ? "Bioq." : ""} ${profesional.nombre} ${profesional.apellido}`.trim(),
        apellido: esPrestador ? "" : profesional.apellido,
        rol: profesional.rol,
        profesion: esPrestador
          ? profesional.especialidad
          : profesional.profesion,
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.json({
      success: true,
      token,
      debe_cambiar_password: profesional.debe_cambiar_password,
      profesional: {
        nombre: esPrestador
          ? profesional.nombre_institucion
          : `${profesional.profesion === "bioquimico" ? "Bioq." : ""} ${profesional.nombre} ${profesional.apellido}`.trim(),
        apellido: esPrestador ? "" : profesional.apellido,
        rol: profesional.rol,
        profesion: esPrestador
          ? profesional.especialidad
          : profesional.profesion,
      },
    });
  } catch (error) {
    console.error("Error en /login:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});
// ── CAMBIAR CONTRASEÑA ──
app.post("/cambiar-password", async (req, res) => {
  try {
    const { usuario, password_actual, password_nuevo } = req.body;

    // Buscar en profesionales primero
    let profesional = null;
    let esPrestador = false;

    const { data: prof } = await supabase
      .from("profesionales")
      .select("*")
      .eq("usuario", usuario)
      .eq("activo", true)
      .single();

    if (prof) {
      profesional = prof;
    } else {
      const { data: prest } = await supabase
        .from("prestadores_institucionales")
        .select("*")
        .eq("usuario", usuario)
        .eq("activo", true)
        .single();
      if (prest) {
        profesional = prest;
        esPrestador = true;
      }
    }

    if (!profesional)
      return res.json({ success: false, message: "Usuario no encontrado." });

    const passwordOk = await bcrypt.compare(
      password_actual,
      profesional.password_hash,
    );
    if (!passwordOk)
      return res.json({
        success: false,
        message: "Contraseña actual incorrecta.",
      });

    const nuevoHash = await bcrypt.hash(password_nuevo, 10);

    const tabla = esPrestador ? "prestadores_institucionales" : "profesionales";
    await supabase
      .from(tabla)
      .update({ password_hash: nuevoHash, debe_cambiar_password: false })
      .eq("usuario", usuario);

    res.json({
      success: true,
      message: "Contraseña actualizada correctamente.",
    });
  } catch (error) {
    console.error("Error en /cambiar-password:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── VERIFICAR TOKEN (para otras apps) ──
app.get("/verificar-token", (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.json({ valido: false });

    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valido: true, profesional: decoded });
  } catch (error) {
    res.json({ valido: false });
  }
});
// ── APROBAR USUARIO (solo superadmin) ──
app.post("/aprobar-usuario", async (req, res) => {
  try {
    const { dni, rol, observaciones } = req.body;
    const adminKey = req.headers["x-admin-key"];

    if (adminKey !== process.env.ADMIN_KEY) {
      return res
        .status(403)
        .json({ success: false, message: "No autorizado." });
    }
    const dniNormalizado = dni.toString().replace(/^[a-zA-Z]+/, '').trim();
    const { data: prof } = await supabase
      .from("profesionales")
      .select("nombre, apellido, email")
      .eq('dni', dniNormalizado)
      .single();

    if (!prof)
      return res.json({
        success: false,
        message: "Profesional no encontrado.",
      });

    const usuario =
      prof.apellido.toLowerCase().replace(/\s/g, "") + dni.slice(-4);
    const passwordTemporal = Math.random().toString(36).slice(-8).toUpperCase();
    const passwordHash = await bcrypt.hash(passwordTemporal, 10);

    await supabase
      .from("profesionales")
      .update({
        usuario,
        password_hash: passwordHash,
        password_temporal: passwordTemporal,
        rol: rol || "profesional",
        activo: true,
        debe_cambiar_password: true,
        fecha_alta: new Date().toISOString(),
        aprobado_por: "admin",
        observaciones,
      })
      .eq('dni', dniNormalizado)

    console.log(`✅ Usuario aprobado: ${usuario} / ${passwordTemporal}`);
    res.json({
      success: true,
      usuario,
      passwordTemporal,
      message: `Usuario creado: ${usuario}`,
    });
  } catch (error) {
    console.error("Error en /aprobar-usuario:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});
// ── LISTAR SOLICITUDES PENDIENTES ──
app.get("/solicitudes-pendientes", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res
        .status(403)
        .json({ success: false, message: "No autorizado." });
    }

    const { data } = await supabase
      .from("profesionales")
      .select(
        "dni, nombre, apellido, profesion, email, telefono, matricula, universidad, fecha_solicitud",
      )
      .eq("activo", false)
      .order("fecha_solicitud", { ascending: false });

    res.json({ success: true, solicitudes: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── LISTAR APROBADOS ──
app.get("/usuarios-aprobados", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    const { data } = await supabase
      .from("profesionales")
      .select("dni, nombre, apellido, profesion, usuario, rol, fecha_alta")
      .eq("activo", true)
      .order("fecha_alta", { ascending: false });

    res.json({ success: true, profesionales: data || [] });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ── RECHAZAR USUARIO ──
app.post("/rechazar-usuario", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    await supabase.from("profesionales").delete().eq("dni", req.body.dni);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

app.post("/desactivar-usuario", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    await supabase
      .from("profesionales")
      .update({ activo: false })
      .eq("dni", req.body.dni);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ── LISTAR PRESTADORES PENDIENTES ──
app.get("/prestadores-pendientes", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    const { data } = await supabase
      .from("prestadores_institucionales")
      .select("*")
      .eq("activo", false)
      .order("fecha_solicitud", { ascending: false });

    res.json({ success: true, prestadores: data || [] });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ── APROBAR PRESTADOR ──
app.post("/aprobar-prestador", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    const id = parseInt(req.body.id);
    console.log("Aprobando prestador id:", id);
    const { data: prest } = await supabase
      .from("prestadores_institucionales")
      .select("nombre_institucion, cuit, especialidad")
      .eq("id", id)
      .single();

    console.log("Prestador encontrado:", prest);

    if (!prest)
      return res.json({ success: false, message: "Prestador no encontrado." });

    const usuario =
      prest.nombre_institucion
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 10) + prest.cuit.slice(-4);
    const passwordTemporal = Math.random().toString(36).slice(-8).toUpperCase();
    const passwordHash = await bcrypt.hash(passwordTemporal, 10);

    await supabase
      .from("prestadores_institucionales")
      .update({
        usuario,
        password_hash: passwordHash,
        password_temporal: passwordTemporal,
        activo: true,
        debe_cambiar_password: true,
        rol: prest.especialidad,
        fecha_alta: new Date().toISOString(),
        aprobado_por: "admin",
      })
      .eq("id", id);

    console.log(`✅ Prestador aprobado: ${usuario} / ${passwordTemporal}`);
    res.json({
      success: true,
      usuario,
      passwordTemporal,
      message: `Prestador creado: ${usuario}`,
    });
  } catch (error) {
    console.error("Error en /aprobar-prestador:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── RECHAZAR PRESTADOR ──
app.post("/rechazar-prestador", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    await supabase
      .from("prestadores_institucionales")
      .delete()
      .eq("id", req.body.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ── LISTAR PRESTADORES APROBADOS ──
app.get("/prestadores-aprobados", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });

    const { data } = await supabase
      .from("prestadores_institucionales")
      .select("id, nombre_institucion, especialidad, usuario, rol, fecha_alta")
      .eq("activo", true)
      .order("fecha_alta", { ascending: false });

    res.json({ success: true, prestadores: data || [] });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

app.post("/desactivar-prestador", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (adminKey !== process.env.ADMIN_KEY)
      return res.status(403).json({ success: false });
    await supabase
      .from("prestadores_institucionales")
      .update({ activo: false })
      .eq("id", req.body.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});
// ── ENDPOINT CENTRALIZADO: /api/estudios-paciente ──
// Agrega esto en server.js de PPDT-Auth, antes del app.listen final.
// Todas las apps del sistema llaman a este único endpoint para obtener
// los estudios complementarios de un paciente, leyendo directo de Supabase.
// Requiere token JWT válido en el header Authorization.

const JWT_SECRET_ESTUDIOS = process.env.JWT_SECRET || "iapos_dp_secret_2025";

app.post("/api/estudios-paciente", async (req, res) => {
  // Verificar token
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token)
      return res
        .status(401)
        .json({ success: false, message: "Token requerido." });
    jwt.verify(token, JWT_SECRET_ESTUDIOS);
  } catch (e) {
    return res
      .status(401)
      .json({ success: false, message: "Token inválido o expirado." });
  }

  const { dni } = req.body;
  if (!dni)
    return res.status(400).json({ success: false, message: "DNI requerido." });

  // Normalizar DNI: quitar letras del principio (F3075796 → 3075796, M12345 → 12345)
  const dniNormalizado = dni
    .toString()
    .replace(/^[a-zA-Z]+/, "")
    .trim();

  try {
    const estudiosEncontrados = [];

    // ── 1. LABORATORIO ──
    const { data: laboratorios } = await supabase
      .from("practicas_historicas")
      .select("*")
      .eq('dni', dniNormalizado)
      .eq("tipo_practica", "laboratorio")
      .order("fecha", { ascending: false });

    (laboratorios || []).forEach((lab) => {
      let links = [];
      try {
        const parsed = JSON.parse(lab.link_pdf || "[]");
        links = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        if (lab.link_pdf) links = [lab.link_pdf];
      }

      const todosLosValores = {
        Glucemia: lab.glucemia || "",
        Creatinina: lab.creatinina || "",
        "Índice Filtrado Glomerular": lab.indice_filtrado_glomerular || "",
        "Colesterol Total": lab.colesterol_total || "",
        "Colesterol HDL": lab.colesterol_hdl || "",
        "Colesterol LDL": lab.colesterol_ldl || "",
        Triglicéridos: lab.trigliceridos || "",
        HIV: lab.hiv || "",
        SOMF: lab.somf || "",
        "Hepatitis B Antígeno Superficie": lab.hepatitis_b_antigeno || "",
        "Hepatitis C": lab.hepatitis_c || "",
        "Hepatitis B Anti Core": lab.hepatitis_b_anti_core || "",
        "HPV Genotipo 16": lab.hpv_genotipo_16 || "",
        "HPV Genotipo 18": lab.hpv_genotipo_18 || "",
        "HPV Otros Genotipos Alto Riesgo": lab.hpv_otros || "",
        VDRL: lab.vdrl || "",
        PSA: lab.psa || "",
        "Chagas HAI": lab.chagas_hai || "",
        "Chagas ECLIA": lab.chagas_eclia || "",
        "Hemoglobina Glicosilada": lab.hemoglobina_glicosilada || "",
        Microalbuminuria: lab.microalbuminuria || "",
        Proteinuria: lab.proteinuria || "",
        "Clearence Creatinina": lab.clearence_creatinina || "",
      };

      const valoresConDato = Object.fromEntries(
        Object.entries(todosLosValores).filter(([_, v]) => v !== ""),
      );

      const esIndividual = lab.es_individual === true;
      let nombrePractica = null;
      if (esIndividual) {
        const campoConValor = Object.entries(todosLosValores).find(
          ([_, v]) => v !== "",
        );
        nombrePractica = campoConValor ? campoConValor[0] : "Individual";
      }

      estudiosEncontrados.push({
        TipoEstudio: esIndividual ? `Lab: ${nombrePractica}` : "Laboratorio",
        DNI: lab.dni,
        Nombre: lab.nombre || "",
        Apellido: lab.apellido || "",
        Fecha: lab.fecha || "",
        Prestador: lab.prestador || "",
        LinkPDF: links[0] || "",
        LinksPDF: links,
        ResultadosLaboratorio: esIndividual ? valoresConDato : todosLosValores,
      });
    });

    // ── 2. ODONTOLOGÍA ──
    const { data: odonto } = await supabase
      .from("odontologia_consultas")
      .select("*")
      .eq('dni', dniNormalizado)
      .order("created_at", { ascending: false });

    (odonto || []).forEach((o) => {
      estudiosEncontrados.push({
        TipoEstudio: "Odontologia",
        DNI: o.dni,
        Nombre: o.nombre || "",
        Apellido: o.apellido || "",
        Fecha: o.fecha || "",
        Prestador: o.odontologo || "",
        LinkPDF: o.enlace_pdf || "",
        Resultado: o.riesgo_evaluacion || o.riesgo_general || "",
        Observaciones: o.observaciones || "",
      });
    });

    // ── 3. ENFERMERÍA ──
    const { data: enfermeria } = await supabase
      .from("enfermeria_consultas")
      .select("*")
      .eq('dni', dniNormalizado)
      .order("created_at", { ascending: false });

    (enfermeria || []).forEach((e) => {
      estudiosEncontrados.push({
        TipoEstudio: "Enfermeria",
        DNI: e.dni,
        Nombre: e.nombre || "",
        Apellido: e.apellido || "",
        Fecha: e.fecha_cierre_enf || "",
        Prestador: e.nombre_enfermera || "",
        ResultadosEnfermeria: {
          Altura: e.altura_cm ? String(e.altura_cm) : "",
          Peso: e.peso_kg ? String(e.peso_kg) : "",
          Circunferencia_cintura: e.circunferencia_cintura_cm
            ? String(e.circunferencia_cintura_cm)
            : "",
          Presion_Arterial: e.presion_arterial || "",
          Vacunas: e.vacunas || "",
          AgudezaVisual: e.agudeza_visual || "",
          Espirometria_PDF: e.espirometria_pdf || "",
        },
      });
    });

    // ── 4. OTRAS PRÁCTICAS HISTÓRICAS ──
    const tiposOtros = [
      "mamografia",
      "eco_mamaria",
      "ecografia",
      "densitometria",
      "vcc",
      "papanicolau",
      "espirometria",
      "biopsia",
      "oftalmologia",
    ];
    const { data: otrasHistoricas } = await supabase
      .from("practicas_historicas")
      .select("*")
      .eq('dni', dniNormalizado)
      .in("tipo_practica", tiposOtros)
      .order("fecha", { ascending: false });

    const ETIQUETAS = {
      mamografia: "Mamografia",
      eco_mamaria: "Eco mamaria",
      ecografia: "Ecografia",
      densitometria: "Densitometria",
      vcc: "VCC",
      papanicolau: "Papanicolau",
      espirometria: "Espirometria",
      biopsia: "Biopsia",
      oftalmologia: "Oftalmologia",
    };

    (otrasHistoricas || []).forEach((p) => {
      let links = [];
      try {
        const parsed = JSON.parse(p.link_pdf || "[]");
        links = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        if (p.link_pdf) links = [p.link_pdf];
      }
      estudiosEncontrados.push({
        TipoEstudio: ETIQUETAS[p.tipo_practica] || p.tipo_practica,
        DNI: p.dni,
        Nombre: p.nombre || "",
        Apellido: p.apellido || "",
        Fecha: p.fecha || "",
        Prestador: p.prestador || "",
        Resultado: p.resultado || "",
        LinkPDF: links[0] || "",
        LinksPDF: links,
      });
    });

    // ── 5. PRÁCTICAS INDIVIDUALES desde practicas_autorizadas ──
    const DESCRIPCIONES_LABORATORIO = [
      "glucemia",
      "colesterol",
      "creatinina",
      "filtrado",
      "trigliceridos",
      "anti_vih",
      "hepatitis",
      "chagas",
      "vdrl",
      "psa",
      "hpv",
      "hemoglobina",
      "microalbuminuria",
      "proteinuria",
      "clearence",
      "somf",
      "anticuerpos anti_v",
    ];

    const { data: practicasInd } = await supabase
      .from("practicas_autorizadas")
      .select("*")
      .eq('dni', dniNormalizado)
      .eq("estado", "REALIZADA")
      .order("fecha_carga", { ascending: false });

    (practicasInd || []).forEach((p) => {
      const desc = (p.descripcion_practica || "").toLowerCase();
      if (DESCRIPCIONES_LABORATORIO.some((lab) => desc.includes(lab))) return;

      const tipo = mapearTipoPractica(desc);
      estudiosEncontrados.push({
        TipoEstudio: tipo,
        DNI: p.dni,
        Nombre: p.nombre_completo?.split(" ").slice(1).join(" ") || "",
        Apellido: p.nombre_completo?.split(" ")[0] || "",
        Fecha: p.fecha_carga
          ? new Date(p.fecha_carga).toISOString().split("T")[0]
          : "",
        Prestador: p.nombre_prestador || "",
        Resultado: p.resultado_texto || "",
        LinkPDF: p.enlace_pdf || "",
        LinksPDF: p.enlace_pdf ? [p.enlace_pdf] : [],
      });
    });

    res.json({ success: true, estudios: estudiosEncontrados });
  } catch (e) {
    console.error("Error en /api/estudios-paciente:", e.message);
    res
      .status(500)
      .json({ success: false, message: "Error al obtener estudios." });
  }
});

function mapearTipoPractica(desc) {
  if (desc.includes("mamog")) return "Mamografia";
  if (desc.includes("eco") && desc.includes("mam")) return "Eco mamaria";
  if (desc.includes("ecograf")) return "Ecografia";
  if (desc.includes("densito")) return "Densitometria";
  if (desc.includes("colon") || desc.includes("vcc")) return "VCC";
  if (desc.includes("pap")) return "Papanicolau";
  if (desc.includes("espiro")) return "Espirometria";
  if (desc.includes("biopsia")) return "Biopsia";
  if (
    desc.includes("oftalm") ||
    desc.includes("visual") ||
    desc.includes("vision")
  )
    return "Oftalmologia";
  return "Otro";
}

app.listen(PORT, () =>
  console.log(`PPDT-Auth corriendo en http://localhost:${PORT}`),
);
