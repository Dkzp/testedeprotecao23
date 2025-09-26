// server.js - VERSÃO FINAL COM AUTENTICAÇÃO

// ===================================================================
//      1. IMPORTAÇÕES
// ===================================================================
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios'; // Mantido para a rota de previsão do tempo
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mongoose from 'mongoose';
import cors from 'cors';

// Importa a função de conexão com o DB
import connectDB from './lib/db.js';

// ---> NOVAS IMPORTAÇÕES PARA AUTENTICAÇÃO <---
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from './models/user.js';
import authMiddleware from './middleware/auth.js'; // Você vai criar este arquivo


// ===================================================================
//      2. CONFIGURAÇÃO INICIAL
// ===================================================================
dotenv.config(); // Carrega variáveis do arquivo .env

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' })); // Permite que o servidor entenda JSON
app.use(cors()); // Permite que seu frontend acesse o backend

const port = process.env.PORT || 3001;
const apiKey = process.env.OPENWEATHER_API_KEY;

connectDB(); // Inicia a conexão com o MongoDB

// ---> SERVINDO ARQUIVOS DO FRONTEND <---
// Isso diz ao Express para usar sua pasta 'public' como a fonte dos arquivos de frontend
app.use(express.static(path.join(__dirname, "public")));


// ===================================================================
//      3. MODELOS DO MONGODB
// ===================================================================

// Sub-schema para o histórico de manutenção
const manutencaoSchema = new mongoose.Schema({
    data: { type: Date, required: true },
    tipo: { type: String, required: true },
    custo: { type: Number, default: 0 },
    descricao: { type: String, default: '' }
}, { _id: false });

// ---> MODELO PRINCIPAL DE VEÍCULOS ATUALIZADO <---
const veiculoGaragemSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    modelo: { type: String, required: true },
    cor: String,
    imagemSrc: String,
    placa: String,
    ano: Number,
    dataVencimentoCNH: Date,
    tipoVeiculo: { type: String, required: true },
    historicoManutencao: [manutencaoSchema],
    turboAtivado: { type: Boolean, default: false },
    capacidadeCarga: { type: Number, default: 0 },
    cargaAtual: { type: Number, default: 0 },
    // ---> CAMPO ADICIONADO PARA LIGAR O VEÍCULO AO DONO <---
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    _id: false
});
const VeiculoGaragem = mongoose.model('VeiculoGaragem', veiculoGaragemSchema);

// (O restante dos seus modelos, como Dica, VeiculoDestaque, etc. continuam aqui)
const dicaSchema = new mongoose.Schema({ /* ... seu schema aqui ... */ });
const VeiculoDestaqueSchema = new mongoose.Schema({ /* ... seu schema aqui ... */ });
// ... e assim por diante para todos os outros.


// ===================================================================
//      4. NOVAS ROTAS DE AUTENTICAÇÃO
// ===================================================================

// ROTA DE REGISTRO (POST /api/auth/register)
app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
            return res.status(400).json({ msg: 'Usuário com este e-mail já existe.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({
            email: email.toLowerCase(),
            password: hashedPassword,
        });

        await user.save();
        res.status(201).json({ msg: 'Usuário registrado com sucesso!' });

    } catch (err) {
        console.error("Erro no registro:", err.message);
        res.status(500).send('Erro no servidor');
    }
});

// ROTA DE LOGIN (POST /api/auth/login)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ msg: 'E-mail ou senha inválidos.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'E-mail ou senha inválidos.' });
        }

        const payload = { user: { id: user.id } };

        jwt.sign(
            payload,
            process.env.JWT_SECRET || 'SEU_SEGREDO_SUPER_SECRETO',
            { expiresIn: '1h' }, // O token expira em 1 hora
            (err, token) => {
                if (err) throw err;
                res.json({ token });
            }
        );
    } catch (err) {
        console.error("Erro no login:", err.message);
        res.status(500).send('Erro no servidor');
    }
});


// ===================================================================
//      5. ROTAS DA API DE VEÍCULOS (AGORA PROTEGIDAS)
// ===================================================================
// O `authMiddleware` será executado antes de cada uma destas rotas.

// ROTA GET: Buscar todos os veículos DO USUÁRIO LOGADO
app.get('/api/garagem/veiculos', authMiddleware, async (req, res) => {
    try {
        // req.user.id vem do middleware de autenticação
        const veiculos = await VeiculoGaragem.find({ owner: req.user.id });
        res.status(200).json(veiculos);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar veículos da garagem' });
    }
});

// ROTA POST: Adicionar um novo veículo PARA O USUÁRIO LOGADO
app.post('/api/garagem/veiculos', authMiddleware, async (req, res) => {
    try {
        const dadosVeiculo = req.body;
        const novoVeiculo = new VeiculoGaragem({
            ...dadosVeiculo,
            _id: dadosVeiculo.id,
            owner: req.user.id // Associa o veículo ao usuário logado
        });
        const veiculoSalvo = await novoVeiculo.save();
        res.status(201).json(veiculoSalvo);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar novo veículo' });
    }
});

// ROTA PUT: Atualizar um veículo existente (verificando o dono)
app.put('/api/garagem/veiculos/:id', authMiddleware, async (req, res) => {
    try {
        const veiculo = await VeiculoGaragem.findById(req.params.id);
        if (!veiculo) {
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        // Garante que o usuário só pode editar o próprio veículo
        if (veiculo.owner.toString() !== req.user.id) {
            return res.status(401).json({ error: 'Acesso não autorizado.' });
        }

        const veiculoAtualizado = await VeiculoGaragem.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        res.status(200).json(veiculoAtualizado);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar veículo.' });
    }
});

// ROTA DELETE: Excluir um veículo (verificando o dono)
app.delete('/api/garagem/veiculos/:id', authMiddleware, async (req, res) => {
    try {
        const veiculo = await VeiculoGaragem.findById(req.params.id);
        if (!veiculo) {
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        if (veiculo.owner.toString() !== req.user.id) {
            return res.status(401).json({ error: 'Acesso não autorizado.' });
        }
        await VeiculoGaragem.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Veículo excluído com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir veículo.' });
    }
});


// ===================================================================
//      6. ROTAS PÚBLICAS (NÃO PRECISAM DE LOGIN)
// ===================================================================

// Endpoint para previsão do tempo (exemplo de rota pública)
app.get('/api/previsao/:cidade', async (req, res) => {
    const { cidade } = req.params;
    if (!apiKey) {
        return res.status(500).json({ error: 'Chave da API não configurada no servidor.' });
    }
    const weatherAPIUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${cidade}&appid=${apiKey}&units=metric&lang=pt_br`;
    try {
        const apiResponse = await axios.get(weatherAPIUrl);
        res.json(apiResponse.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Erro ao buscar dados do clima.' });
    }
});

// (Qualquer outra rota pública que você tenha, como dicas, veículos em destaque, etc. ficaria aqui)


// ===================================================================
//      7. INICIA O SERVIDOR
// ===================================================================
app.listen(port, () => {
    console.log(`Servidor fofinho rodando em http://localhost:${port}`);
    if (!process.env.JWT_SECRET) {
        console.warn("***************** ATENÇÃO: JWT_SECRET não configurada no .env! *****************");
    }
});