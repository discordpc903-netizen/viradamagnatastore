const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 📋 LOGS
// ============================================================
const LOGS_FILE = path.join(__dirname, 'logs', 'logs.json');

if (!fs.existsSync(path.join(__dirname, 'logs'))) {
    fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
}

function salvarLog(tipo, mensagem, dados = {}) {
    const logs = fs.existsSync(LOGS_FILE) 
        ? JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8')) 
        : [];

    const log = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        data: new Date().toLocaleString('pt-BR'),
        hora: new Date().toLocaleTimeString('pt-BR'),
        tipo: tipo,
        mensagem: mensagem,
        ip: dados.ip || 'desconhecido',
        usuario: dados.usuario || 'anonimo',
        isAdmin: dados.isAdmin || false,
        detalhes: dados
    };

    logs.push(log);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
    return log;
}

function getLogs() {
    if (!fs.existsSync(LOGS_FILE)) {
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
    } catch (error) {
        return [];
    }
}

// ============================================================
// 🔑 GLADEPAY - CONFIGURAÇÃO
// ============================================================
const GLADEPAY_API_URL = 'https://web-production-73dbd.up.railway.app/api/v1';
const GLADEPAY_API_KEY = 'gp_93e8e9aed079b33e89a3007d5d1aff50b41de711c3834179';

// ============================================================
// 🔐 AUTENTICAÇÃO ADMIN
// ============================================================
const ADMIN_USER = 'DONOMAGNATASTORE';
const ADMIN_PASS = 'gabriel201128';

// ============================================================
// 📦 SISTEMA DE ESTOQUE (COM PLANO TESTE)
// ============================================================
const ESTOQUE_FILE = path.join(__dirname, 'estoque.json');

function carregarEstoque() {
    if (!fs.existsSync(ESTOQUE_FILE)) {
        const inicial = {
            produtos: {
                'virada_15': { nome: 'Virada R$ 15 (TESTE)', preco: 10, quantidade: 50 },
                'virada_20': { nome: 'Virada R$ 20', preco: 20, quantidade: 100 },
                'virada_40': { nome: 'Virada R$ 40', preco: 40, quantidade: 100 },
                'virada_80': { nome: 'Virada R$ 80', preco: 80, quantidade: 100 },
                'virada_120': { nome: 'Virada R$ 120', preco: 120, quantidade: 100 },
                'virada_240': { nome: 'Virada R$ 240', preco: 240, quantidade: 100 },
                'virada_480': { nome: 'Virada R$ 480', preco: 480, quantidade: 100 }
            }
        };
        fs.writeFileSync(ESTOQUE_FILE, JSON.stringify(inicial, null, 2));
        return inicial;
    }
    return JSON.parse(fs.readFileSync(ESTOQUE_FILE, 'utf8'));
}

function salvarEstoque(estoque) {
    fs.writeFileSync(ESTOQUE_FILE, JSON.stringify(estoque, null, 2));
}

// ============================================================
// 📡 ROTAS DA API
// ============================================================

// 🔐 LOGIN
app.post('/api/login', (req, res) => {
    try {
        const { user, pass } = req.body;
        
        if (user === ADMIN_USER && pass === ADMIN_PASS) {
            salvarLog('login', 'Login Admin: ' + user, { usuario: user, tipo: 'admin' });
            return res.json({ success: true, isAdmin: true, user: user });
        }
        
        salvarLog('login', 'Tentativa de login: ' + user, { usuario: user });
        res.json({ success: false, error: 'Usuário ou senha incorretos' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 📋 Buscar logs
app.get('/api/logs', (req, res) => {
    try {
        if (!fs.existsSync(LOGS_FILE)) {
            return res.json({ success: true, logs: [] });
        }
        const logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
        const ultimos = logs.slice(-50).reverse();
        res.json({ success: true, logs: ultimos, total: logs.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 📝 Registrar log
app.post('/api/log', (req, res) => {
    try {
        const { tipo, mensagem, dados } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        const log = salvarLog(tipo, mensagem, {
            ...dados,
            ip: ip,
            userAgent: req.headers['user-agent']
        });
        
        res.json({ success: true, log });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 💰 GERAR PIX - NÃO DIMINUI ESTOQUE
app.post('/api/pagar', async (req, res) => {
    try {
        const { amount, clientReference, produtoId } = req.body;
        
        if (!amount || amount < 5) {
            return res.status(400).json({ success: false, error: 'Valor mínimo R$ 5,00' });
        }

        if (produtoId) {
            const estoque = carregarEstoque();
            if (!estoque.produtos[produtoId]) {
                return res.status(400).json({ success: false, error: 'Produto não encontrado' });
            }
            if (estoque.produtos[produtoId].quantidade <= 0) {
                return res.status(400).json({ success: false, error: 'Produto esgotado!' });
            }
        }

        console.log('💰 Gerando PIX de R$', amount);

        const WEBHOOK_URL = 'https://viradamagnatastore.up.railway.app/api/webhook';

        const response = await fetch(`${GLADEPAY_API_URL}/pix/create`, {
            method: 'POST',
            headers: {
                'X-API-Key': GLADEPAY_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount,
                clientReference: clientReference || `pedido-${Date.now()}`,
                callbackUrl: WEBHOOK_URL
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Erro GladePay:', data);
            throw new Error(data.message || 'Erro ao gerar PIX');
        }

        console.log('✅ PIX gerado:', data.id || data.transactionId);

        salvarLog('pagamento', `PIX gerado: R$ ${amount}`, {
            amount: amount,
            transactionId: data.id || data.transactionId,
            clientReference: clientReference,
            produtoId: produtoId
        });

        res.json({ success: true, data });

    } catch (error) {
        console.error('❌ Erro:', error.message);
        salvarLog('erro', 'Erro ao gerar PIX: ' + error.message, {
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔍 VERIFICAR PIX
app.get('/api/verificar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('🔍 Verificando PIX:', id);

        const response = await fetch(`${GLADEPAY_API_URL}/transaction/${id}`, {
            headers: {
                'X-API-Key': GLADEPAY_API_KEY
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Erro ao verificar');
        }

        console.log('📊 Status:', data.status);

        salvarLog('info', `Status verificado: ${data.status}`, {
            transactionId: id,
            status: data.status
        });

        res.json({ success: true, data });

    } catch (error) {
        console.error('❌ Erro ao verificar:', error.message);
        salvarLog('erro', 'Erro ao verificar: ' + error.message, {
            error: error.message,
            id: req.params.id
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔔 WEBHOOK - DIMINUI ESTOQUE QUANDO CONFIRMADO
app.post('/api/webhook', async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('📩 Webhook recebido:', webhookData);

        const transactionId = webhookData.id || webhookData.transactionId;
        const status = webhookData.status || 'PENDING';
        const amount = webhookData.amount || 0;
        const clientReference = webhookData.clientReference || '';

        salvarLog('webhook', `Webhook recebido: ${status} - ${transactionId}`, {
            transactionId: transactionId,
            status: status,
            amount: amount,
            clientReference: clientReference,
            dados: webhookData
        });

        if (status === 'COMPLETED' || status === 'confirmed') {
            console.log(`✅ Pagamento CONFIRMADO! ID: ${transactionId}`);
            console.log(`💰 Valor: R$ ${amount}`);
            console.log(`📦 Referência: ${clientReference}`);

            let produtoId = null;
            
            if (clientReference && clientReference.startsWith('pedido-')) {
                const partes = clientReference.split('-');
                if (partes.length >= 2) {
                    const possivelProdutoId = partes[0];
                    const estoque = carregarEstoque();
                    if (estoque.produtos[possivelProdutoId]) {
                        produtoId = possivelProdutoId;
                    }
                }
            }

            if (!produtoId) {
                const logs = getLogs();
                const logEncontrado = logs.find(l => 
                    l.tipo === 'pagamento' && 
                    l.detalhes && 
                    l.detalhes.transactionId === transactionId &&
                    l.detalhes.produtoId
                );
                if (logEncontrado && logEncontrado.detalhes && logEncontrado.detalhes.produtoId) {
                    produtoId = logEncontrado.detalhes.produtoId;
                }
            }

            if (produtoId) {
                try {
                    const estoque = carregarEstoque();
                    if (estoque.produtos[produtoId]) {
                        const qtdAtual = estoque.produtos[produtoId].quantidade;
                        if (qtdAtual > 0) {
                            estoque.produtos[produtoId].quantidade = qtdAtual - 1;
                            salvarEstoque(estoque);
                            
                            salvarLog('estoque', `Estoque diminuído via webhook: ${produtoId} → ${estoque.produtos[produtoId].quantidade}`, {
                                produtoId,
                                novaQuantidade: estoque.produtos[produtoId].quantidade,
                                transactionId: transactionId,
                                status: status
                            });
                            
                            console.log(`📦 Estoque atualizado: ${produtoId} → ${estoque.produtos[produtoId].quantidade}`);
                        } else {
                            console.log(`⚠️ Estoque já zerado para: ${produtoId}`);
                        }
                    } else {
                        console.log(`⚠️ Produto não encontrado: ${produtoId}`);
                    }
                } catch (error) {
                    console.error('❌ Erro ao atualizar estoque:', error.message);
                    salvarLog('erro', 'Erro ao atualizar estoque no webhook: ' + error.message, {
                        error: error.message,
                        produtoId: produtoId,
                        transactionId: transactionId
                    });
                }
            } else {
                console.log('⚠️ Não foi possível identificar o produtoId para diminuir o estoque');
                salvarLog('info', 'Webhook sem produtoId para estoque', {
                    transactionId: transactionId,
                    clientReference: clientReference
                });
            }
        }

        res.status(200).json({ 
            success: true, 
            message: 'Webhook recebido com sucesso' 
        });

    } catch (error) {
        console.error('❌ Erro no webhook:', error.message);
        salvarLog('erro', 'Erro no webhook: ' + error.message, {
            error: error.message,
            dados: req.body
        });
        res.status(200).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 📦 ROTAS DE ESTOQUE
// ============================================================

app.get('/api/estoque', (req, res) => {
    try {
        const estoque = carregarEstoque();
        res.json({ success: true, estoque });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/estoque/atualizar', (req, res) => {
    try {
        const adminKey = req.headers['admin-key'];
        if (adminKey !== 'MAGNATA_ADMIN_2024') {
            return res.status(403).json({ success: false, error: 'Não autorizado' });
        }

        const { produtoId, quantidade, preco } = req.body;
        const estoque = carregarEstoque();
        
        if (!estoque.produtos[produtoId]) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }

        if (quantidade !== undefined && quantidade < 0) {
            return res.status(400).json({ success: false, error: 'Quantidade não pode ser negativa' });
        }

        if (quantidade !== undefined) {
            estoque.produtos[produtoId].quantidade = quantidade;
        }
        if (preco !== undefined && preco >= 0) {
            estoque.produtos[produtoId].preco = preco;
        }
        
        salvarEstoque(estoque);

        salvarLog('admin', `Estoque atualizado: ${produtoId} → Qtd: ${estoque.produtos[produtoId].quantidade}, Preço: R$ ${estoque.produtos[produtoId].preco}`, {
            produtoId,
            quantidade,
            preco
        });

        res.json({ success: true, message: 'Estoque atualizado', produto: estoque.produtos[produtoId] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/estoque/adicionar', (req, res) => {
    try {
        const adminKey = req.headers['admin-key'];
        if (adminKey !== 'MAGNATA_ADMIN_2024') {
            return res.status(403).json({ success: false, error: 'Não autorizado' });
        }

        const { id, nome, preco, quantidade } = req.body;
        const estoque = carregarEstoque();
        
        if (estoque.produtos[id]) {
            return res.status(400).json({ success: false, error: 'Produto já existe' });
        }

        if (!id || !nome || preco === undefined || quantidade === undefined) {
            return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios' });
        }

        estoque.produtos[id] = { nome, preco, quantidade: parseInt(quantidade) || 0 };
        salvarEstoque(estoque);

        salvarLog('admin', `Produto adicionado: ${nome} (${id})`, {
            produtoId: id,
            nome,
            preco,
            quantidade
        });

        res.json({ success: true, message: 'Produto adicionado', produto: estoque.produtos[id] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/estoque/remover/:id', (req, res) => {
    try {
        const adminKey = req.headers['admin-key'];
        if (adminKey !== 'MAGNATA_ADMIN_2024') {
            return res.status(403).json({ success: false, error: 'Não autorizado' });
        }

        const { id } = req.params;
        const estoque = carregarEstoque();
        
        if (!estoque.produtos[id]) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }

        const nome = estoque.produtos[id].nome;
        delete estoque.produtos[id];
        salvarEstoque(estoque);

        salvarLog('admin', `Produto removido: ${nome}`, { produtoId: id });

        res.json({ success: true, message: 'Produto removido' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🗑️ LIMPAR LOGS
app.delete('/api/logs', (req, res) => {
    try {
        const adminKey = req.headers['admin-key'];
        if (adminKey !== 'MAGNATA_ADMIN_2024') {
            return res.status(403).json({ success: false, error: 'Não autorizado' });
        }
        
        if (fs.existsSync(LOGS_FILE)) {
            fs.writeFileSync(LOGS_FILE, JSON.stringify([]));
        }
        
        salvarLog('admin', 'Logs limpos pelo admin');
        res.json({ success: true, message: 'Logs limpos com sucesso' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/logs/download', (req, res) => {
    try {
        const adminKey = req.headers['admin-key'];
        if (adminKey !== 'MAGNATA_ADMIN_2024') {
            return res.status(403).json({ success: false, error: 'Não autorizado' });
        }
        
        if (!fs.existsSync(LOGS_FILE)) {
            return res.status(404).json({ success: false, error: 'Nenhum log encontrado' });
        }
        
        const logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🚀 INICIAR SERVIDOR
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`🔑 GladePay: ✅ Configurada`);
    console.log(`📁 Logs salvos em: ${LOGS_FILE}`);
    console.log(`📦 Estoque: ${ESTOQUE_FILE}`);
    console.log(`🔔 Webhook: https://viradamagnatastore.up.railway.app/api/webhook`);
    console.log(`✅ Estoque só diminui quando o webhook confirmar!`);
    console.log(`🔥 Plano Teste R$ 10 → R$ 100 adicionado!`);
});
