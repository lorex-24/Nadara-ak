const fs = require('fs');
const path = require('path');
const login = require('./disme-fca/index');
const express = require('express');
const app = express();
const chalk = require('chalk');
const bodyParser = require('body-parser');
const script = path.join(__dirname, 'script');
const cron = require('node-cron');

const configPath = './data/config.json';
const config = fs.existsSync('./data') && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : createConfig();

const Utils = {
  commands: new Map(),
  handleEvent: new Map(),
  account: new Map(),
  cooldowns: new Map(),
};

fs.readdirSync(script).forEach((file) => {
  const scriptsPath = path.join(script, file);
  const stats = fs.statSync(scriptsPath);
  
  const processScriptFile = (scriptFile) => {
    try {
      const { config, run, handleEvent } = require(scriptFile);
      if (config) {
        const {
          name = [],
          role = '0',
          version = '1.0.0',
          hasPrefix = true,
          aliases = [],
          description = '',
          usage = '',
          credits = '',
          cooldown = '5',
        } = Object.fromEntries(Object.entries(config).map(([key, value]) => [key.toLowerCase(), value]));
        
        aliases.push(name);
        
        if (run) {
          Utils.commands.set(aliases, {
            name,
            role,
            run,
            aliases,
            description,
            usage,
            version,
            hasPrefix,
            credits,
            cooldown
          });
        }
        
        if (handleEvent) {
          Utils.handleEvent.set(aliases, {
            name,
            handleEvent,
            role,
            description,
            usage,
            version,
            hasPrefix,
            credits,
            cooldown
          });
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error installing command from file ${scriptFile}: ${error.message}`));
    }
  };

  if (stats.isDirectory()) {
    fs.readdirSync(scriptsPath).forEach(file => processScriptFile(path.join(scriptsPath, file)));
  } else {
    processScriptFile(scriptsPath);
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(express.json());

const routes = [
  { path: '/', file: 'index.html' },
  { path: '/step_by_step_guide', file: 'guide.html' },
  { path: '/online_user', file: 'online.html' },
];

routes.forEach(route => {
  app.get(route.path, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
});

app.get('/info', (req, res) => {
  const data = Array.from(Utils.account.values()).map(account => ({
    name: account.name,
    profileUrl: account.profileUrl,
    thumbSrc: account.thumbSrc,
    time: account.time
  }));
  res.json(data);
});

app.get('/commands', (req, res) => {
  const command = new Set();
  const commands = [...Utils.commands.values()].map(({ name }) => {
    command.add(name);
    return name;
  });
  
  const handleEvent = [...Utils.handleEvent.values()].map(({ name }) => command.has(name) ? null : (command.add(name), name)).filter(Boolean);
  const role = [...Utils.commands.values()].map(({ role }) => {
    command.add(role);
    return role;
  });
  
  const aliases = [...Utils.commands.values()].map(({ aliases }) => {
    command.add(aliases);
    return aliases;
  });
  
  res.json({ commands, handleEvent, role, aliases });
});

app.post('/login', async (req, res) => {
  const { state, commands, prefix, admin } = req.body;
  
  try {
    if (!state) {
      throw new Error('Missing app state data');
    }
    
    const cUser = state.find(item => item.key === 'c_user');
    if (cUser) {
      const existingUser = Utils.account.get(cUser.value);
      if (existingUser) {
        console.log(`User ${cUser.value} is already logged in`);
        return res.status(400).json({
          error: false,
          message: "Active user session detected; already logged in",
          user: existingUser
        });
      } 
      
      try {
        await accountLogin(state, commands, prefix, [admin]);
        res.status(200).json({
          success: true,
          message: 'Authentication process completed successfully; login achieved.'
        });
      } catch (error) {
        console.error(error);
        res.status(400).json({
          error: true,
          message: error.message
        });
      }
    } else {
      return res.status(400).json({
        error: true,
        message: "There's an issue with the appstate data; it's invalid."
      });
    }
  } catch (error) {
    return res.status(400).json({
      error: true,
      message: "There's an issue with the appstate data; it's invalid."
    });
  }
});

app.listen(3000, () => {
  console.log(`Server is running at http://localhost:3000`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

async function accountLogin(state, enableCommands = [], prefix, admin = []) {
  return new Promise((resolve, reject) => {
    login({ appState: state }, async (error, api) => {
      if (error) {
        reject(error);
        return;
      }
      
      const userid = await api.getCurrentUserID();
      addThisUser(userid, enableCommands, state, prefix, admin);
      
      try {
        const userInfo = await api.getUserInfo(userid);
        if (!userInfo || !userInfo[userid]?.name || !userInfo[userid]?.profileUrl || !userInfo[userid]?.thumbSrc) {
          throw new Error('Unable to locate the account; it appears to be in a suspended or locked state.');
        }
        
        const { name, profileUrl, thumbSrc } = userInfo[userid];
        const time = (JSON.parse(fs.readFileSync('./data/history.json', 'utf-8')).find(user => user.userid === userid) || {}).time || 0;
        Utils.account.set(userid, { name, profileUrl, thumbSrc, time });
        
        const intervalId = setInterval(() => {
          const account = Utils.account.get(userid);
          if (!account) {
            clearInterval(intervalId);
            return;
          }
          Utils.account.set(userid, { ...account, time: account.time + 1 });
        }, 1000);
        
        api.setOptions({
          listenEvents: config[0].fcaOption.listenEvents,
          logLevel: config[0].fcaOption.logLevel,
          updatePresence: config[0].fcaOption.updatePresence,
          selfListen: config[0].fcaOption.selfListen,
          forceLogin: config[0].fcaOption.forceLogin,
          online: config[0].fcaOption.online,
          autoMarkDelivery: config[0].fcaOption.autoMarkDelivery,
          autoMarkRead: config[0].fcaOption.autoMarkRead,
        });
        
        api.listenMqtt(async (error, event) => {
          if (error) {
            console.error(`Error during API listen: ${error}`, userid);
            return;
          }
          
          let database = fs.existsSync('./data/database.json') ? JSON.parse(fs.readFileSync('./data/database.json', 'utf8')) : createDatabase();
          let data = Array.isArray(database) ? database.find(item => Object.keys(item)[0] === event?.threadID) : {};
          let adminIDS = data ? database : createThread(event.threadID, api);
          let blacklist = (JSON.parse(fs.readFileSync('./data/history.json', 'utf-8')).find(blacklist => blacklist.userid === userid) || {}).blacklist || [];
          let hasPrefix = (event.body && aliases(event.body.trim().toLowerCase().split(/ +/).shift())?.hasPrefix === false) ? '' : prefix;
          let [command, ...args] = ((event.body || '').trim().toLowerCase().startsWith(hasPrefix?.toLowerCase()) ? (event.body || '').trim().substring(hasPrefix?.length).trim().split(/\s+/).map(arg => arg.trim()) : []);
          
          if (hasPrefix && aliases(command)?.hasPrefix === false) {
            api.sendMessage(`Invalid usage this command doesn't need a prefix`, event.threadID, event.messageID);
            return;
          }
          
          if (event.body && aliases(command)?.name) {
            const role = aliases(command)?.role ?? 0;
            const isAdmin = config?.[0]?.masterKey?.admin?.includes(event.senderID) || admin.includes(event.senderID);
            const isThreadAdmin = isAdmin || ((Array.isArray(adminIDS) ? adminIDS.find(admin => Object.keys(admin)[0] === event.threadID) : {})?.[event.threadID] || []).some(admin => admin.id === event.senderID);
            if ((role == 1 && !isAdmin) || (role == 2 && !isThreadAdmin) || (role == 3 && !blacklist.includes(event.senderID))) {
              return api.sendMessage(`Permission denied. You don't have permission to use this command`, event.threadID, event.messageID);
            }
            
            if (Utils.commands.has(aliases(command)?.aliases)) {
              const commandData = Utils.commands.get(aliases(command)?.aliases);
              const cooldown = commandData.cooldown || 5;
              const now = Date.now();
              const timestamps = Utils.cooldowns.get(commandData.aliases) || new Map();
              const lastCommandTime = timestamps.get(event.senderID);
              const commandCooldown = Math.floor((cooldown * 1000) - (now - lastCommandTime));
              
              if (lastCommandTime && commandCooldown > 0) {
                return api.sendMessage(`Please wait ${Math.ceil(commandCooldown / 1000)} seconds before reusing the command.`, event.threadID, event.messageID);
              }
              
              timestamps.set(event.senderID, now);
              Utils.cooldowns.set(commandData.aliases, timestamps);
              
              try {
                await commandData.run({ api, event, args });
              } catch (error) {
                console.error(`Error while executing command: ${error}`);
                api.sendMessage(`Error executing command: ${error.message}`, event.threadID, event.messageID);
              }
            }
          }
        });
        
        resolve(api);
      } catch (error) {
        reject(error);
      }
    });
  });
}
