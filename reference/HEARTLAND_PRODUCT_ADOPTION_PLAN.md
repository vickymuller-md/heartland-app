# HEARTLAND — Plano de Produto, Usabilidade e Adoção

**Status:** execução técnica de P0–P3 implementada; validação independente e piloto pendentes
**Data-base:** 13 de julho de 2026
**Última atualização:** 14 de julho de 2026
**Escopo:** experiência provider/patient, utilidade diária, organização funcional, validação, adoção e implantação

## 0. Estado de implementação — 14 de julho de 2026

Implementado nesta release:

- Daily Loop canônico com `Now`, `Today`, `This week` e `Watching`;
- cards com prioridade, severidade, freshness, owner, prazo, motivo e ações rastreáveis;
- brief de 60 segundos, timeline unificada e action center no workspace do paciente;
- persistência imediata e idempotente de red flags na fila de alertas;
- portal do paciente orientado a `Today`, plano de cuidado, contato e histórico de acesso;
- fila, eventos imutáveis, telemetria sem identificador clínico e políticas RLS no banco;
- estados explícitos para erro, vazio, offline, dado ausente e entrega não confirmada;
- boundaries de uso, claims financeiros e conteúdo clínico revisados para reduzir overreach;
- testes automatizados, build de produção, auditoria de dependências e migration hospedada validados.
- inbox operacional unifica work items e mensagens com evidência explícita de disponibilidade/leitura;
- delegação governada por organization, workload com aging e owner, e revisão mensal de acesso;
- filtros pessoais salvos por status, severidade, prioridade e origem no Daily Loop;
- settings por organization para timezone, target operacional e contato de downtime;
- playbook degradado público, imprimível e sem PHI, também precacheado para indisponibilidade;
- registro versionado das regras clínicas de maior risco, fechado por padrão até revisão independente;
- MFA TOTP obrigatório para provider em proxy, Server Actions e RLS;
- monitor diário agregado de postura, CI com lint/test/build/pgTAP/SBOM/CodeQL e Dependabot.

Ainda não concluído — depende de pessoas, contratos ou evidência externa:

- entrevistas e testes moderados com usuários-alvo;
- revisão clínica independente e silent mode;
- piloto assistido em uma facility;
- BAA, definição formal de data controller/processor e aceite de risco;
- fechamento integral dos controles organizacionais e de infraestrutura do plano de segurança;
- evidência de retenção, impacto clínico, economia ou reimbursement.
- nomeação de owners operacionais/clínicos e aprovação dos targets pela facility;
- aprovação independente dos seis rule sets atualmente marcados como `pending_independent_review`.

**Estado de liberação:** adequado para sandbox público e avaliação controlada com dados sintéticos. Não aprovado para PHI real, cuidado não supervisionado ou claims clínicos/financeiros até todos os gates das seções 9–12 e do plano de segurança passarem.

## 1. Objetivo

Transformar HEARTLAND de coleção ampla de ferramentas do protocolo em produto que um profissional rural considere indispensável no manejo diário de heart failure (HF).

Resultado pretendido:

> Ao abrir HEARTLAND, provider entende em menos de 60 segundos quem precisa de atenção, por quê, qual ação é segura agora, quem é responsável e quando o caso volta à fila.

Este plano não autoriza uso clínico, claims de eficácia ou armazenamento de PHI. Liberação para dados reais depende dos gates clínicos, de segurança e governança definidos abaixo.

## 2. Diagnóstico executivo

HEARTLAND possui tese forte, conteúdo amplo e boa cobertura do continuum de HF: risco, GDMT, comorbidades, discharge, remote monitoring, educação, mensagens, relatórios e implementação rural.

Problema atual: valor está fragmentado por módulos. Provider precisa interpretar navegação e montar mentalmente o workflow. Produto apresenta ferramentas, mas ainda não fecha o ciclo de trabalho.

### Situação atual

```text
Escolher módulo → localizar paciente → interpretar dados → decidir ação
→ procurar onde registrar → lembrar follow-up → retornar depois
```

### Situação-alvo

```text
Sinal/evento → prioridade → brief de 60 segundos → ação segura
→ documentação → owner + prazo → próximo item devido → resultado
```

### Contradição estrutural a resolver

Documentação histórica define app como ferramenta educacional, client-side, sem dados de pacientes. Implementação atual contém contas, pacientes identificáveis, vitais, medicamentos, exames, mensagens, notas e exports.

Decisão obrigatória:

1. **Sandbox público:** conteúdo educacional e dados exclusivamente sintéticos; sem PHI.
2. **Clinical Workspace:** produto separado e governado, com autorização, auditoria, segurança e validação clínica.

Misturar os dois modelos enfraquece confiança, segurança, claims e adoção.

## 3. Usuários e jobs-to-be-done

### Provider rural

- Saber quais pacientes precisam de ação agora.
- Entender mudança desde último contato sem revisar prontuário inteiro.
- Aplicar pathway consistente sem perder julgamento clínico.
- Documentar ação rapidamente.
- Coordenar follow-up com equipe limitada.
- Funcionar sob baixa conectividade e pressão de tempo.

### Care coordinator, nurse ou pharmacist

- Trabalhar fila delegada com escopo claro.
- Identificar pendências, tentativas e escalations.
- Registrar contato e devolver caso ao owner correto.
- Evitar duplicação ou perda de tarefas.

### Patient

- Saber o que precisa fazer hoje.
- Registrar informação com baixo atrito.
- Entender quando procurar ajuda e qual canal usar.
- Ver quem possui acesso aos seus dados.
- Receber comunicação simples, sem alarmismo ou exposição de PHI.

### Program/facility lead

- Saber se workflow está sendo usado.
- Identificar gargalos, atrasos e cobertura.
- Demonstrar processo e qualidade sem claims financeiros ou clínicos não validados.

## 4. Proposta de valor indispensável

HEARTLAND não deve competir como prontuário completo ou biblioteca de referência. Posição recomendada:

> Camada operacional de implementação para HF rural: converte sinais e protocolo em trabalho priorizado, seguro, documentado e fechado.

Três motivos para uso diário:

1. **Reduz busca:** uma fila confiável substitui navegação entre módulos.
2. **Reduz carga cognitiva:** brief resume mudança, contexto e próximo passo.
3. **Fecha loop:** toda ação produz owner, prazo, status e retorno à fila.

## 5. Auditoria de usabilidade e gaps

| Área | Gap atual | Consequência | Estado-alvo |
|---|---|---|---|
| Navegação | Módulos independentes e muitos destinos | Provider precisa conhecer arquitetura | Navegação orientada a tarefa e paciente |
| Home provider | Dashboard informativo, não fila operacional única | Valor diário pouco evidente | `Now / Today / This week` |
| Worklist | Consulta inconsistente com schema pode retornar vazio | Perda de confiança na prioridade | Fonte canônica, testes e empty states honestos |
| Alertas | Pipeline vitals→alert está desativado | Expectativa de monitoramento não corresponde ao sistema | Pipeline validado, idempotente e observável |
| Inbox | Não organiza claramente por severidade e prazo | Mensagem compete com risco clínico | Inbox integrada à fila e ao paciente |
| Patient workspace | Contexto espalhado por páginas e módulos | Revisão lenta e retrabalho | Timeline + brief + action center |
| Documentação | Ação e follow-up não formam unidade | Loops ficam abertos | Registro transacional com owner e due date |
| Handoffs | Links e destinos podem quebrar | Ação termina sem fechamento | Handoff acionável, rastreável e testado |
| Patient portal | Muitas funções, pouca orientação diária | Baixa clareza e adesão | Uma tela “Today” com próxima ação |
| Offline | Armazena fila clínica sem isolamento seguro | Risco e comportamento imprevisível | Escopo mínimo, explícito e seguro |
| Empty/error states | Falha pode parecer ausência de trabalho | Risco operacional | Diferenciar vazio, offline, erro e sem permissão |
| Conteúdo clínico | Alguns pathways/claims precisam de revisão atual | Risco de overreach ou recomendação errada | Conteúdo versionado, fonte e owner clínico |
| Confiança | Synthetic-only conflita com funcionalidades clínicas | Usuário não entende responsabilidade do produto | Boundaries explícitos por ambiente |

## 6. Produto-norte: HEARTLAND Daily Loop

### 6.1 Fila única

Home provider passa a responder quatro perguntas:

1. O que exige ação agora?
2. O que vence hoje?
3. O que pode aguardar esta semana?
4. O que mudou desde última revisão?

Seções:

- **Now:** risco agudo, deterioration, resultado crítico ou follow-up vencido.
- **Today:** tarefas clínicas e operacionais com prazo no dia.
- **This week:** otimização, educação, reconciliação, exames e acompanhamento.
- **Watching:** sinais relevantes sem ação imediata.

Cada card precisa mostrar:

- paciente e contexto mínimo;
- motivo da prioridade;
- mudança desde baseline/último contato;
- prazo;
- owner;
- ação principal;
- estado de segurança/qualidade do dado.

### 6.2 Brief de 60 segundos

Ao abrir caso:

- resumo HF e contexto relevante;
- mudança em sintomas, peso, vitais e labs;
- medicamentos atuais e gaps documentados;
- contatos, discharge ou eventos recentes;
- alertas ativos e ações anteriores;
- próxima decisão prevista pelo workflow;
- incertezas e dados ausentes.

Brief deve informar; não ocultar fonte nem transformar framework não validado em recomendação determinística.

### 6.3 Action Center

Ações frequentes no mesmo contexto:

- contatar patient;
- documentar avaliação;
- solicitar/revisar dado;
- encaminhar ou escalar;
- atribuir a membro da equipe;
- agendar follow-up;
- reconhecer/justificar override;
- fechar tarefa.

Toda ação relevante cria trilha, status, owner e próximo prazo.

### 6.4 Closed-loop follow-up

Estado recomendado:

```text
New → Reviewed → Actioned → Awaiting patient/data → Due → Closed
```

Regras:

- Nenhum item crítico some por simples visualização.
- Snooze exige motivo e nova data.
- Reassignment registra origem/destino.
- Fechamento exige outcome mínimo.
- Falha de integração nunca aparece como “zero itens”.

## 7. Arquitetura de informação proposta

### Sandbox público

- About/evidence.
- Ferramentas educacionais.
- Pocket cards.
- Implementation tier selector.
- Casos sintéticos claramente rotulados.
- Nenhum login clínico, paciente real ou tracking PHI.

### Clinical Workspace — provider

1. **Home:** Daily Loop.
2. **Patients:** busca e cohorts permitidos.
3. **Patient workspace:** brief, timeline, action center, care plan e follow-up.
4. **Inbox:** mensagens ligadas ao caso/tarefa.
5. **Reports:** qualidade e operação, sob autorização forte.
6. **Team & access:** memberships, assignments e access review.
7. **Settings:** notificações, dispositivos, segurança e preferências.

### Clinical Workspace — patient

1. **Today:** próxima ação e instrução autorizada.
2. **Check-in:** sintomas/vitais necessários.
3. **Medications:** lista reconciliada e adherence entry.
4. **Messages:** comunicação segura.
5. **Plan:** próximos contatos e follow-ups.
6. **Privacy & access:** providers vinculados, sessões e revogação.

## 8. Backlog priorizado

### P0 — confiança e bloqueadores

- Corrigir worklist/schema e estados de erro.
- Corrigir rotas/handoffs quebrados.
- Não representar alertas como ativos enquanto pipeline estiver desligado.
- Separar sandbox sintético e clinical workspace.
- Remover claims contraditórios sobre PHI e finalidade.
- Fechar gaps críticos de segurança antes de qualquer dado real.
- Revisar conteúdo clínico de maior risco: risk framework individual, titration default, HFmrEF/finerenone, RPM e G0511.
- Fazer build, TypeScript, lint e suíte essencial ficarem verdes.

### P1 — fundação operacional

- Modelo canônico de tarefa/evento/prioridade.
- Source-of-truth para alertas e due dates.
- Patient timeline consistente.
- Owner, status, prazo e outcome em todas ações.
- Design system de severity, freshness e data quality.
- Empty/error/loading/offline states padronizados.
- Instrumentação privacy-safe para funil e task completion.

### P2 — Daily Loop

- Home `Now / Today / This week`.
- Brief de 60 segundos.
- Action Center.
- Inbox contextual.
- Delegação e closed-loop follow-up.
- Patient “Today”.
- Busca e filtros salvos por papel.

### P3 — “uau” para adoção

- Explicação transparente: “por que este item está aqui?”.
- Resumo de mudanças desde última revisão.
- Preparação automática do próximo contato.
- Handoff com contexto mínimo já estruturado.
- Team workload com aging e cobertura.
- Access history e revoke visíveis ao patient.
- Safe degraded mode para baixa conectividade.
- Implementation playbook adaptado à capacidade da facility.

### P4 — escala validada

- Integrações somente após workflow interno estável.
- Templates por facility sem forks de lógica.
- Benchmarking apenas com governança e small-cell suppression.
- Advanced analytics somente após qualidade de dados comprovada.

## 9. Roadmap integrado

| Período | Fase | Entregas principais | Gate de saída |
|---|---|---|---|
| 0–2 semanas | Contenção e confiança | P0 funcional, decisão sandbox/clinical, claims corrigidos, segurança S0/S1 iniciada | Nenhum fluxo apresenta capacidade inexistente |
| 2–6 semanas | Fundação | Task model, worklist confiável, timeline, statuses, testes e observabilidade | Fluxos críticos reproduzíveis e auditáveis |
| 6–12 semanas | Daily Loop | Fila única, brief, action center, inbox, patient Today | Teste interno conclui tarefas ponta a ponta |
| 12–16 semanas | Teste formativo | 5–8 providers representativos, think-aloud, simulações e revisão clínica | Usabilidade e conteúdo atingem critérios mínimos |
| 16–20 semanas | Silent mode | Prioridades calculadas sem orientar usuário; comparação com revisão humana | Concordância, false positives e misses aceitáveis |
| 20–28 semanas | Piloto assistido | Uma facility, cohort controlada, suporte próximo e rollback | Segurança, workflow e adoção sustentados |

Segurança é gate transversal. Clinical Workspace não recebe PHI apenas porque uma fase de produto terminou.

## 10. Métricas

### North-star operacional

**Percentual de itens prioritários fechados corretamente dentro do prazo.**

### Time-to-value

- Tempo até provider identificar primeira ação prioritária.
- Tempo para abrir e compreender brief.
- Tempo para registrar ação + próximo follow-up.
- Número de telas/cliques por workflow crítico.

### Usabilidade

- Task completion sem ajuda.
- Erros, retornos e abandonos por tarefa.
- System Usability Scale ou UMUX-Lite.
- Compreensão correta de severity, deadline e owner.
- Diferença desktop/mobile e baixa conectividade.

### Segurança e qualidade clínica

- Misses e false positives por regra.
- Overrides e justificativas.
- Alertas sem owner ou follow-up.
- Dados stale/ausentes usados em decisões.
- Incidentes, near misses e cross-tenant denials.

### Adoção

- Providers ativados que concluem um Daily Loop real.
- WAU/MAU por papel, sem tratar login como valor.
- Retenção em 4, 8 e 12 semanas.
- Tasks fechadas por workflow.
- Facilities que mantêm uso após suporte inicial.

### Patient experience

- Check-ins concluídos.
- Mensagens respondidas.
- Clareza da próxima ação.
- Opt-out, suporte e reclamações.
- Falhas de sincronização percebidas.

Claims de redução de internação, revenue, economia ou melhoria clínica exigem desenho de avaliação próprio. Não derivar eficácia de métricas de uso.

## 11. Gates de liberação

### Gate clínico

- Cada rule/pathway possui versão, fonte, owner e revisão independente.
- Frameworks propostos aparecem como propostos, não validados.
- Nenhuma ação determinística substitui julgamento profissional.
- Safety cases, overrides e escalation paths testados.

### Gate de segurança

- Cumprir integralmente o gate para piloto definido em [HEARTLAND_SECURITY_PLAN.md](./HEARTLAND_SECURITY_PLAN.md).

### Gate de usabilidade

- Pelo menos 90% das tarefas críticas concluídas sem ajuda em teste moderado.
- Nenhum participante interpreta falha técnica como ausência de risco.
- Brief compreendido corretamente por todos os papéis autorizados.
- Fluxos críticos utilizáveis em viewport móvel.

### Gate operacional

- Owner e suporte definidos.
- Degraded/manual workflow documentado.
- Monitoramento, rollback e incident escalation ativos.
- Facility confirma responsabilidade, staffing e tempo de resposta.

### Gate de adoção

- Problema e cohort de entrada claramente definidos.
- Provider percebe valor no primeiro turno de uso.
- Retenção não depende de reminders excessivos ou suporte artesanal permanente.

## 12. Pesquisa e validação

### Rodada 1 — descoberta contextual

- 5–8 profissionais rurais ou non-specialists.
- Observar workflow real, artefatos paralelos e interruptions.
- Mapear onde risco, contato e follow-up se perdem.

### Rodada 2 — protótipo do Daily Loop

- Cenários sintéticos, think-aloud e comparação com fluxo atual.
- Medir compreensão, tempo, erro e confiança.

### Rodada 3 — silent mode

- Regras não influenciam cuidado.
- Comparar prioridade calculada com avaliação humana e outcome operacional.

### Rodada 4 — piloto assistido

- Uma facility, escopo pequeno, treinamento e canal de suporte.
- Revisão semanal de segurança, conteúdo, workflow e adoção.

## 13. Decisões pendentes

1. Produto permanecerá estritamente educacional ou terá Clinical Workspace real?
2. Primeiro usuário pagante/adotante: clinic lead, provider individual ou program manager?
3. Primeiro cohort: post-discharge, GDMT optimization ou remote monitoring?
4. Qual papel será owner da fila e do tempo de resposta?
5. Offline clínico é requisito de lançamento ou pode começar como online/degraded mode?
6. Qual facility e quais reviewers participarão do silent mode/piloto?
7. Quais claims públicos serão mantidos, removidos ou submetidos a validação?

## 14. Critério de conclusão do plano

Plano considerado executado quando:

- produto resolve um workflow principal ponta a ponta;
- provider encontra prioridade e age em poucos minutos;
- patient entende próxima ação;
- todo item possui owner, prazo e outcome;
- segurança e conteúdo passam gates independentes;
- piloto demonstra uso sustentado, não apenas curiosidade inicial;
- nenhum claim excede evidência disponível.
