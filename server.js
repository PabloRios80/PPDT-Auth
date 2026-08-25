require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const axios = require("axios");
const https = require("https");
const agenteIapos = new https.Agent({ rejectUnauthorized: false });

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

    const dniNormalizado = dni
      .toString()
      .replace(/^[a-zA-Z]+/, "")
      .trim();
    const { data: existe } = await supabase
      .from("profesionales")
      .select("id, activo")
      .eq("dni", dniNormalizado)
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

    let profesional = null;
    let tipoUsuario = "profesional"; // "profesional" | "prestador" | "empleado"
    let institucionPadre = null;

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
        tipoUsuario = "prestador";
      } else {
        const { data: empleado } = await supabase
          .from("prestadores_institucionales_usuarios")
          .select("*")
          .eq("usuario", usuario)
          .eq("activo", true)
          .single();

        if (empleado) {
          profesional = empleado;
          tipoUsuario = "empleado";
          const { data: institucion } = await supabase
            .from("prestadores_institucionales")
            .select("*")
            .eq("id", empleado.id_prestador)
            .single();
          institucionPadre = institucion;
        }
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

    const esPrestador = tipoUsuario === "prestador";
    const esEmpleado = tipoUsuario === "empleado";

    const nombreCompleto = esPrestador
      ? profesional.nombre_institucion
      : esEmpleado
        ? `${profesional.nombre || ""} ${profesional.apellido || ""}`.trim()
        : `${profesional.profesion === "bioquimico" ? "Bioq. " : ""}${profesional.nombre}`.trim();

    const profesionValor = esPrestador
      ? profesional.especialidad
      : esEmpleado
        ? institucionPadre?.especialidad || null
        : profesional.profesion;

    const idSedeValor = esPrestador ? null : profesional.id_sede_dp || null; // empleado ya trae su propio id_sede_dp

    const tokenPayload = {
      id: profesional.id,
      usuario: profesional.usuario,
      nombre: nombreCompleto,
      apellido: esPrestador ? "" : profesional.apellido || "",
      rol: profesional.rol || (esEmpleado ? "empleado_prestador" : null),
      profesion: profesionValor,
      id_sede_dp: idSedeValor,
      puede_cerrar_interno:
        esPrestador || esEmpleado
          ? false
          : profesional.puede_cerrar_interno || false,
      puede_derivar:
        esPrestador || esEmpleado ? false : profesional.puede_derivar || false,
      es_superuser:
        esPrestador || esEmpleado ? false : profesional.es_superuser || false,
      ve_tablero: profesional.ve_tablero ?? true,
      ve_agenda: profesional.ve_agenda ?? true,
      ve_crm: profesional.ve_crm ?? true,
      ve_practicas: profesional.ve_practicas ?? true,
      ve_consultas: profesional.ve_consultas ?? true,
    };

    if (esEmpleado) {
      tokenPayload.id_prestador = profesional.id_prestador;
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "8h" });

    res.json({
      success: true,
      token,
      debe_cambiar_password: profesional.debe_cambiar_password,
      profesional: {
        nombre: nombreCompleto,
        apellido: esPrestador ? "" : profesional.apellido || "",
        rol: tokenPayload.rol,
        profesion: profesionValor,
        id_sede_dp: idSedeValor,
        es_superuser: tokenPayload.es_superuser,
        ve_tablero: tokenPayload.ve_tablero,
        ve_agenda: tokenPayload.ve_agenda,
        ve_crm: tokenPayload.ve_crm,
        ve_practicas: tokenPayload.ve_practicas,
        ve_consultas: tokenPayload.ve_consultas,
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
    const dniNormalizado = dni
      .toString()
      .replace(/^[a-zA-Z]+/, "")
      .trim();
    const { data: prof } = await supabase
      .from("profesionales")
      .select("nombre, apellido, email")
      .eq("dni", dniNormalizado)
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
        puede_cerrar_interno: req.body.puede_cerrar_interno === true,
        puede_derivar: req.body.puede_derivar === true,
        es_superuser: req.body.es_superuser === true,
      })
      .eq("dni", dniNormalizado);

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
      .select(
        "dni, nombre, apellido, profesion, usuario, rol, fecha_alta, id_sede_dp",
      )
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
      .eq("dni", dniNormalizado)
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
      .eq("dni", dniNormalizado)
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
      .eq("dni", dniNormalizado)
      .order("created_at", { ascending: false });

    (enfermeria || []).forEach((e) => {
      estudiosEncontrados.push({
        TipoEstudio: "Enfermeria",
        DNI: e.dni,
        Nombre: e.nombre || "",
        Apellido: e.apellido || "",
        Fecha: e.fecha_cierre_enf || "",
        Prestador: e.nombre_enfermera || "",
        LinkPDF: e.espirometria_pdf || "",
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
      .eq("dni", dniNormalizado)
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
      .eq("dni", dniNormalizado)
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

app.get("/sedes-dp", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ error: "No autorizado" });
  try {
    const { data, error } = await supabase
      .from("sedes_dp")
      .select("*")
      .eq("activo", true)
      .order("ciudad");
    if (error) throw error;
    res.json({ sedes: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/asignar-sede", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ error: "No autorizado" });
  const { dni, id_sede_dp } = req.body;
  try {
    const { error } = await supabase
      .from("profesionales")
      .update({ id_sede_dp })
      .eq("dni", dni);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post("/asignar-superuser", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ error: "No autorizado" });
  const { dni, es_superuser } = req.body;
  try {
    const { error } = await supabase
      .from("profesionales")
      .update({ es_superuser: !!es_superuser })
      .eq("dni", dni);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// Verificar afiliado IAPOS
app.get("/verificar-afiliado/:dni", async (req, res) => {
  const dni = req.params.dni;
  const hoy = new Date().toISOString().split("T")[0];
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
            <BEWsValidaAfi.Execute xmlns="IAPOS_WS">
                <Usuario>CONSULTAPDP</Usuario>
                <Passwd>1Qaz</Passwd>
                <Nafiliado>${dni}</Nafiliado>
                <Badocnumdo>${dni}</Badocnumdo>
                <Tidocodigo_de_documento>96</Tidocodigo_de_documento>
                <Ogorcodigo>1</Ogorcodigo>
                <Fechpresta>${hoy}</Fechpresta>
            </BEWsValidaAfi.Execute>
        </soap:Body>
    </soap:Envelope>`;
  try {
    const response = await axios.post(
      "https://aswe.santafe.gov.ar/iapos-sw-srvt/servlet/abewsvalidaafi",
      soapBody,
      {
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "IAPOS_WSaction/ABEWSVALIDAAFI.Execute",
        },
        timeout: 10000,
        httpsAgent: agenteIapos,
      },
    );
    const xml = response.data;
    const get = (tag) => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : null;
    };
    res.json({
      esActivo: get("Estado") === "A",
      estado: get("Estado"),
      nombre: get("Apenom"),
      edad: get("Edad"),
      sexo: get("Sexo"),
      localidad: get("Localidad"),
      mensaje: get("Msgdsc"),
    });
  } catch (e) {
    res.status(500).json({ esActivo: false, error: e.message });
  }
});

// Prácticas pendientes por DNI
app.get("/api/practicas-pendientes/:dni", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET);

    const dni = req.params.dni;

    const [{ data: practicas }, { data: enfermeria }, { data: odontologia }] =
      await Promise.all([
        supabase
          .from("practicas_autorizadas")
          .select("descripcion_practica, codigo_prestacion")
          .eq("dni", dni)
          .eq("estado", "AUTORIZADA"),
        supabase.from("enfermeria_consultas").select("id").eq("dni", dni).limit(1),
        supabase.from("odontologia_consultas").select("id").eq("dni", dni).limit(1),
      ]);

    const tieneEnfermeria = (enfermeria || []).length > 0;
    const tieneOdontologia = (odontologia || []).length > 0;

    // Descripciones genéricas que se dan por resueltas si ya hubo consulta
    // real de enfermería u odontología, aunque su fila individual en
    // practicas_autorizadas nunca pase a REALIZADA.
    const CUBIERTAS_POR_ENFERMERIA = [
      "tomar ta",
      "calcular imc",
      "vacuna",
      "control vision",
      "control visión",
    ];
    const CUBIERTAS_POR_ODONTOLOGIA = ["odontolog"];

    const pendientesFiltradas = (practicas || []).filter((p) => {
      const desc = (p.descripcion_practica || "").toLowerCase();
      if (tieneEnfermeria && CUBIERTAS_POR_ENFERMERIA.some((k) => desc.includes(k)))
        return false;
      if (tieneOdontologia && CUBIERTAS_POR_ODONTOLOGIA.some((k) => desc.includes(k)))
        return false;
      return true;
    });

    res.json({ success: true, practicas: pendientesFiltradas });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Turnos externos por DNI
app.get("/api/turnos-externos-afiliado/:dni", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET);
    const { data } = await supabase
      .from("turnos_prestadores_externos")
      .select("practica, nombre_prestador, fecha_turno, hora_turno, estado")
      .eq("dni", req.params.dni)
      .order("created_at", { ascending: false });
    res.json({ success: true, turnos: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Derivaciones por DNI
app.get("/api/derivaciones-afiliado/:dni", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET);
    const { data } = await supabase
      .from("derivaciones")
      .select("especialidad, motivo, estado, fecha_seguimiento")
      .eq("dni", req.params.dni)
      .order("fecha_derivacion", { ascending: false });
    res.json({ success: true, derivaciones: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Último DP por DNI
app.get("/api/ultimo-dp/:dni", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET);
    const { data } = await supabase
      .from("historial_dia_preventivo")
      .select("fechax, efector, tipo")
      .eq("dni", req.params.dni)
      .order("fechax", { ascending: false })
      .limit(1)
      .single();
    res.json({ success: true, ultimoDP: data || null });
  } catch (e) {
    res.json({ success: true, ultimoDP: null });
  }
});

app.get("/api/hoja-de-vida/:dni", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET);
    const { data } = await supabase
      .from("historial_hoja_de_vida")
      .select("*")
      .eq("dni", req.params.dni)
      .order("fecha_carga", { ascending: false })
      .limit(1)
      .single();
    res.json({ success: true, hojaDeVida: data || null });
  } catch (e) {
    res.json({ success: true, hojaDeVida: null });
  }
});
// Sedes de un prestador
app.get("/prestador-sedes/:id_prestador", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("prestador_sedes")
      .select("id, id_sede_dp, sedes_dp(nombre, ciudad)")
      .eq("id_prestador", req.params.id_prestador);
    if (error) throw error;
    res.json({ success: true, sedes: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Asignar una sede a un prestador
app.post("/prestador-sedes", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ success: false });
  const { id_prestador, id_sede_dp } = req.body;
  try {
    const { error } = await supabase
      .from("prestador_sedes")
      .insert({ id_prestador, id_sede_dp });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// Endpoint público de solo lectura (sin x-admin-key) para el formulario de solicitud de acceso
app.get("/sedes-dp-publico", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("sedes_dp")
      .select("id, nombre, ciudad")
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    res.json({ success: true, sedes: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Quitar una sede de un prestador
app.delete("/prestador-sedes/:id", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ success: false });
  try {
    await supabase.from("prestador_sedes").delete().eq("id", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PRÁCTICAS QUE PUEDE CARGAR CADA PRESTADOR INSTITUCIONAL ──
app.get("/prestador-practicas/:id_prestador", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("prestador_practicas")
      .select("id, practica")
      .eq("id_prestador", req.params.id_prestador);
    if (error) throw error;
    res.json({ success: true, practicas: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/prestador-practicas", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ success: false });
  const { id_prestador, practica } = req.body;
  try {
    const { error } = await supabase
      .from("prestador_practicas")
      .insert({ id_prestador, practica });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete("/prestador-practicas/:id_prestador/:practica", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY)
    return res.status(403).json({ success: false });
  try {
    await supabase
      .from("prestador_practicas")
      .delete()
      .eq("id_prestador", req.params.id_prestador)
      .eq("practica", req.params.practica);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.listen(PORT, () =>
  console.log(`PPDT-Auth corriendo en http://localhost:${PORT}`),
);