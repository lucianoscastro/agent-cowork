/**
 * The Notifications card (Setup → General): the webhook. Shape: Translations in i18n.tsx (no import, so the server's tests can
 * load this file as it is).
 */
const translations = {
  'pt-BR': {
    Notifications: 'Notificações',
    'A webhook that receives a JSON post for each event: text for Slack, Mattermost and Teams workflows, content for Discord, and the fields for anything else (n8n, Zapier, your own endpoint). Nothing is sent while no webhook is stored.':
      'Um webhook que recebe um POST em JSON a cada evento: text para Slack, Mattermost e workflows do Teams, content para o Discord, e os campos para qualquer outro destino (n8n, Zapier, seu próprio endpoint). Nada é enviado enquanto não houver webhook salvo.',
    'Webhook URL': 'URL do webhook',
    "Stored encrypted, as it carries the channel's token.": 'Guardada criptografada, porque leva o token do canal.',
    'Something needs a person (Inbox)': 'Algo precisa de uma pessoa (Caixa de entrada)',
    'An agent opened or updated pull requests (Developer, Documenter)': 'Um agente abriu ou atualizou pull requests (Developer, Documenter)',
    'A provider paused at its usage limit': 'Um provedor pausou no limite de uso',
    'Dependabot merged a pull request': 'O Dependabot fez merge de um pull request',
    'Address of this UI (optional)': 'Endereço desta interface (opcional)',
    'Used for links in the messages, e.g. https://agents.example.com. Empty: messages link to the GitHub or Jira item only.':
      'Usado nos links das mensagens, por exemplo https://agents.example.com. Vazio: as mensagens apontam só para o item no GitHub ou no Jira.',
    'Send test': 'Enviar teste',
    'No webhook URL stored': 'Nenhuma URL de webhook salva',
    'The webhook must be an http(s) URL': 'O webhook precisa ser uma URL http(s)',
    Events: 'Eventos',
  },
  'es-ES': {
    Notifications: 'Notificaciones',
    'A webhook that receives a JSON post for each event: text for Slack, Mattermost and Teams workflows, content for Discord, and the fields for anything else (n8n, Zapier, your own endpoint). Nothing is sent while no webhook is stored.':
      'Un webhook que recibe un POST en JSON por cada evento: text para Slack, Mattermost y flujos de Teams, content para Discord, y los campos para cualquier otro destino (n8n, Zapier, tu propio endpoint). No se envía nada mientras no haya un webhook guardado.',
    'Webhook URL': 'URL del webhook',
    "Stored encrypted, as it carries the channel's token.": 'Se guarda cifrada, porque lleva el token del canal.',
    'Something needs a person (Inbox)': 'Algo necesita a una persona (Bandeja de entrada)',
    'An agent opened or updated pull requests (Developer, Documenter)': 'Un agente abrió o actualizó pull requests (Developer, Documenter)',
    'A provider paused at its usage limit': 'Un proveedor se pausó por su límite de uso',
    'Dependabot merged a pull request': 'Dependabot fusionó un pull request',
    'Address of this UI (optional)': 'Dirección de esta interfaz (opcional)',
    'Used for links in the messages, e.g. https://agents.example.com. Empty: messages link to the GitHub or Jira item only.':
      'Se usa en los enlaces de los mensajes, por ejemplo https://agents.example.com. Vacío: los mensajes enlazan solo al elemento en GitHub o Jira.',
    'Send test': 'Enviar prueba',
    'No webhook URL stored': 'No hay una URL de webhook guardada',
    'The webhook must be an http(s) URL': 'El webhook debe ser una URL http(s)',
    Events: 'Eventos',
  },
};

export default translations;
