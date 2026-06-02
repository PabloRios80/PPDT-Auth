require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'iapos_dp_secret_2025';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── SOLICITAR ACCESO ──
app.post('/solicitar-acceso', async (req, res) => {
    try {
        const {
            dni, apellido, nombre, fecha_nacimiento,
            profesion, universidad, matricula,
            telefono, email, prestador_id, observaciones
        } = req.body;

        // Validar campos obligatorios
        const sinMatricula = ['enfermera', 'preventivista'];
        if (!dni || !apellido || !nombre || !profesion || !email || 
            (!matricula && !sinMatricula.includes(profesion))) {
            return res.json({ success: false, message: 'Completá todos los campos obligatorios.' });
        }

        // Verificar si ya existe
        const { data: existe } = await supabase
            .from('profesionales')
            .select('id, activo')
            .eq('dni', dni)
            .single();

        if (existe) {
            if (existe.activo) return res.json({ success: false, message: 'Ya tenés acceso al sistema. Usá tu usuario y contraseña.' });
            return res.json({ success: false, message: 'Tu solicitud ya fue recibida y está pendiente de aprobación.' });
        }

        // Insertar solicitud
        const { error } = await supabase
            .from('profesionales')
            .insert({
                dni, apellido, nombre, fecha_nacimiento,
                profesion, universidad, matricula,
                telefono, email, prestador_id,
                observaciones, activo: false,
                fecha_solicitud: new Date().toISOString()
            });

        if (error) {
            console.error('Error Supabase:', error);
            return res.json({ success: false, message: 'Error al registrar la solicitud.' });
        }

        console.log(`✅ Nueva solicitud de acceso: ${nombre} ${apellido} (${profesion})`);
        res.json({ success: true, message: 'Solicitud enviada correctamente. Recibirás tus credenciales por email una vez aprobada.' });

    } catch (error) {
        console.error('Error en /solicitar-acceso:', error.message);
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── LOGIN ──
app.post('/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;

        const { data: profesional, error } = await supabase
            .from('profesionales')
            .select('*')
            .eq('usuario', usuario)
            .eq('activo', true)
            .single();

        if (error || !profesional) {
            return res.json({ success: false, message: 'Usuario o contraseña incorrectos.' });
        }

        // Verificar contraseña
        const passwordOk = await bcrypt.compare(password, profesional.password_hash);
        console.log('Password ok:', passwordOk);
        if (!passwordOk) {
            return res.json({ success: false, message: 'Usuario o contraseña incorrectos.' });
        }

        // Generar token JWT
        const token = jwt.sign({
            id: profesional.id,
            usuario: profesional.usuario,
            nombre: profesional.nombre,
            apellido: profesional.apellido,
            rol: profesional.rol,
            profesion: profesional.profesion
        }, JWT_SECRET, { expiresIn: '8h' });

        res.json({
            success: true,
            token,
            debe_cambiar_password: profesional.debe_cambiar_password,
            profesional: {
                nombre: profesional.nombre,
                apellido: profesional.apellido,
                rol: profesional.rol,
                profesion: profesional.profesion
            }
        });

    } catch (error) {
        console.error('Error en /login:', error.message);
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── CAMBIAR CONTRASEÑA ──
app.post('/cambiar-password', async (req, res) => {
    try {
        const { usuario, password_actual, password_nuevo } = req.body;

        const { data: profesional } = await supabase
            .from('profesionales')
            .select('*')
            .eq('usuario', usuario)
            .eq('activo', true)
            .single();

        if (!profesional) return res.json({ success: false, message: 'Usuario no encontrado.' });

        const passwordOk = await bcrypt.compare(password_actual, profesional.password_hash);
        if (!passwordOk) return res.json({ success: false, message: 'Contraseña actual incorrecta.' });

        const nuevoHash = await bcrypt.hash(password_nuevo, 10);
        await supabase
            .from('profesionales')
            .update({ password_hash: nuevoHash, debe_cambiar_password: false })
            .eq('usuario', usuario);

        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });

    } catch (error) {
        console.error('Error en /cambiar-password:', error.message);
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── VERIFICAR TOKEN (para otras apps) ──
app.get('/verificar-token', (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.json({ valido: false });

        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valido: true, profesional: decoded });

    } catch (error) {
        res.json({ valido: false });
    }
});

// ── APROBAR USUARIO (solo superadmin) ──
app.post('/aprobar-usuario', async (req, res) => {
    try {
        const { dni, rol, observaciones } = req.body;
        const adminKey = req.headers['x-admin-key'];

        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ success: false, message: 'No autorizado.' });
        }

        // Generar usuario y contraseña temporal
        const { data: prof } = await supabase
            .from('profesionales')
            .select('nombre, apellido, email')
            .eq('dni', dni)
            .single();

        if (!prof) return res.json({ success: false, message: 'Profesional no encontrado.' });

        const usuario = (prof.apellido.toLowerCase().replace(/\s/g, '') + dni.slice(-4));
        const passwordTemporal = Math.random().toString(36).slice(-8).toUpperCase();
        const passwordHash = await bcrypt.hash(passwordTemporal, 10);

        await supabase
            .from('profesionales')
            .update({
                usuario,
                password_hash: passwordHash,
                password_temporal: passwordTemporal,
                rol: rol || 'profesional',
                activo: true,
                debe_cambiar_password: true,
                fecha_alta: new Date().toISOString(),
                aprobado_por: 'admin',
                observaciones
            })
            .eq('dni', dni);

        console.log(`✅ Usuario aprobado: ${usuario} / ${passwordTemporal}`);
        // Enviar email con credenciales
        axios.post(process.env.EMAIL_SCRIPT_URL, {
            nombre: prof.nombre,
            apellido: prof.apellido,
            email: prof.email,
            usuario,
            passwordTemporal
        }).then(() => console.log('✅ Email enviado a:', prof.email))
        .catch(e => console.warn('Email falló:', e.message));
            res.json({ success: true, usuario, passwordTemporal, message: `Usuario creado: ${usuario}` });

        } catch (error) {
            console.error('Error en /aprobar-usuario:', error.message);
            res.status(500).json({ success: false, message: 'Error de conexión.' });
        }
    });

// ── LISTAR SOLICITUDES PENDIENTES ──
app.get('/solicitudes-pendientes', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ success: false, message: 'No autorizado.' });
        }

        const { data } = await supabase
            .from('profesionales')
            .select('dni, nombre, apellido, profesion, email, telefono, matricula, universidad, fecha_solicitud')
            .eq('activo', false)
            .order('fecha_solicitud', { ascending: false });

        res.json({ success: true, solicitudes: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── LISTAR APROBADOS ──
app.get('/usuarios-aprobados', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ success: false });

        const { data } = await supabase
            .from('profesionales')
            .select('dni, nombre, apellido, profesion, usuario, rol, fecha_alta')
            .eq('activo', true)
            .order('fecha_alta', { ascending: false });

        res.json({ success: true, profesionales: data || [] });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ── RECHAZAR USUARIO ──
app.post('/rechazar-usuario', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ success: false });

        await supabase.from('profesionales').delete().eq('dni', req.body.dni);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/desactivar-usuario', async (req, res) => {
    try {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ success: false });

        await supabase.from('profesionales')
            .update({ activo: false })
            .eq('dni', req.body.dni);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.listen(PORT, () => console.log(`PPDT-Auth corriendo en http://localhost:${PORT}`));