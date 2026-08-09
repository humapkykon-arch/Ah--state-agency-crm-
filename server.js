const express = require("express");
const http = require("http");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET";
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new Database(path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'partner',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS properties(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 deal TEXT NOT NULL,
 type TEXT NOT NULL,
 location TEXT NOT NULL,
 bedrooms INTEGER DEFAULT 0,
 budget REAL DEFAULT 0,
 owner TEXT,
 contact TEXT,
 status TEXT DEFAULT 'Available',
 notes TEXT,
 created_by INTEGER,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 deal TEXT NOT NULL,
 type TEXT NOT NULL,
 location TEXT NOT NULL,
 bedrooms INTEGER DEFAULT 0,
 budget REAL DEFAULT 0,
 name TEXT NOT NULL,
 contact TEXT,
 notes TEXT,
 status TEXT DEFAULT 'Active',
 created_by INTEGER,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 action TEXT NOT NULL,
 entity TEXT,
 entity_id INTEGER,
 details TEXT,
 created_at TEXT NOT NULL
);
`);

function now(){ return new Date().toISOString(); }
function logActivity(user, action, entity, entityId, details=""){
  db.prepare("INSERT INTO activity(user_id,action,entity,entity_id,details,created_at) VALUES(?,?,?,?,?,?)")
    .run(user?.id || null, action, entity || null, entityId || null, details, now());
  io.emit("activity");
}
function seedUsers(){
  const count = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  if(!count){
    const hash1 = bcrypt.hashSync("Admin@12345", 12);
    const hash2 = bcrypt.hashSync("Partner@12345", 12);
    db.prepare("INSERT INTO users(name,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
      .run("Admin","admin",hash1,"admin",now());
    db.prepare("INSERT INTO users(name,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
      .run("Partner","partner",hash2,"partner",now());
  }
}
seedUsers();

app.use(express.json({limit:"2mb"}));
app.use(session({
  secret: SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:1000*60*60*24*7}
}));
app.use(express.static(path.join(__dirname,"public")));

function auth(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"Login required"});
  next();
}
function admin(req,res,next){
  if(req.session.user?.role !== "admin") return res.status(403).json({error:"Admin only"});
  next();
}
function clean(s){ return String(s ?? "").trim(); }

app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));

app.post("/api/login",(req,res)=>{
  const username=clean(req.body.username), password=String(req.body.password||"");
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if(!u || !bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:"Invalid username or password"});
  req.session.user={id:u.id,name:u.name,username:u.username,role:u.role};
  logActivity(req.session.user,"LOGIN","user",u.id,`${u.username} logged in`);
  res.json({user:req.session.user});
});
app.post("/api/logout",(req,res)=>{
  const u=req.session.user;
  req.session.destroy(()=>{ if(u) logActivity(u,"LOGOUT","user",u.id,`${u.username} logged out`); res.json({ok:true}); });
});

app.get("/api/dashboard",auth,(req,res)=>{
  const properties=db.prepare("SELECT * FROM properties ORDER BY updated_at DESC").all();
  const customers=db.prepare("SELECT * FROM customers ORDER BY updated_at DESC").all();
  const recent=db.prepare(`
    SELECT a.*, COALESCE(u.name,'System') user_name
    FROM activity a LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.id DESC LIMIT 15
  `).all();
  res.json({
    stats:{
      properties:properties.length,
      customers:customers.length,
      rent:properties.filter(x=>x.deal==="Rent").length,
      sale:properties.filter(x=>x.deal==="Sale").length,
      activeCustomers:customers.filter(x=>x.status==="Active").length
    },
    properties,customers,recent
  });
});

app.get("/api/properties",auth,(req,res)=>{
  res.json(db.prepare("SELECT * FROM properties ORDER BY updated_at DESC").all());
});
app.post("/api/properties",auth,(req,res)=>{
  const b=req.body;
  if(!clean(b.location)) return res.status(400).json({error:"Location is required"});
  const info=db.prepare(`
    INSERT INTO properties(deal,type,location,bedrooms,budget,owner,contact,status,notes,created_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(clean(b.deal)||"Rent",clean(b.type)||"House",clean(b.location),Number(b.bedrooms)||0,Number(b.budget)||0,
    clean(b.owner),clean(b.contact),clean(b.status)||"Available",clean(b.notes),req.session.user.id,now());
  logActivity(req.session.user,"ADD","property",info.lastInsertRowid,`${b.type} in ${b.location}`);
  res.json({id:info.lastInsertRowid});
});
app.put("/api/properties/:id",auth,(req,res)=>{
  const id=Number(req.params.id), b=req.body;
  if(!db.prepare("SELECT id FROM properties WHERE id=?").get(id)) return res.status(404).json({error:"Not found"});
  db.prepare(`
    UPDATE properties SET deal=?,type=?,location=?,bedrooms=?,budget=?,owner=?,contact=?,status=?,notes=?,updated_at=?
    WHERE id=?
  `).run(clean(b.deal),clean(b.type),clean(b.location),Number(b.bedrooms)||0,Number(b.budget)||0,clean(b.owner),clean(b.contact),clean(b.status)||"Available",clean(b.notes),now(),id);
  logActivity(req.session.user,"UPDATE","property",id,`${b.type} in ${b.location}`);
  res.json({ok:true});
});
app.delete("/api/properties/:id",auth,(req,res)=>{
  const id=Number(req.params.id); db.prepare("DELETE FROM properties WHERE id=?").run(id);
  logActivity(req.session.user,"DELETE","property",id,"Property deleted"); res.json({ok:true});
});

app.get("/api/customers",auth,(req,res)=>res.json(db.prepare("SELECT * FROM customers ORDER BY updated_at DESC").all()));
app.post("/api/customers",auth,(req,res)=>{
  const b=req.body;
  if(!clean(b.location)||!clean(b.name)) return res.status(400).json({error:"Customer name and area are required"});
  const info=db.prepare(`
    INSERT INTO customers(deal,type,location,bedrooms,budget,name,contact,notes,status,created_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(clean(b.deal)||"Rent",clean(b.type)||"House",clean(b.location),Number(b.bedrooms)||0,Number(b.budget)||0,
    clean(b.name),clean(b.contact),clean(b.notes),clean(b.status)||"Active",req.session.user.id,now());
  logActivity(req.session.user,"ADD","customer",info.lastInsertRowid,`${b.name} needs ${b.type} in ${b.location}`);
  res.json({id:info.lastInsertRowid});
});
app.put("/api/customers/:id",auth,(req,res)=>{
  const id=Number(req.params.id), b=req.body;
  db.prepare(`
    UPDATE customers SET deal=?,type=?,location=?,bedrooms=?,budget=?,name=?,contact=?,notes=?,status=?,updated_at=?
    WHERE id=?
  `).run(clean(b.deal),clean(b.type),clean(b.location),Number(b.bedrooms)||0,Number(b.budget)||0,clean(b.name),clean(b.contact),clean(b.notes),clean(b.status)||"Active",now(),id);
  logActivity(req.session.user,"UPDATE","customer",id,`${b.name} / ${b.location}`);
  res.json({ok:true});
});
app.delete("/api/customers/:id",auth,(req,res)=>{
  const id=Number(req.params.id); db.prepare("DELETE FROM customers WHERE id=?").run(id);
  logActivity(req.session.user,"DELETE","customer",id,"Customer demand deleted"); res.json({ok:true});
});

app.get("/api/matches/:customerId",auth,(req,res)=>{
  const c=db.prepare("SELECT * FROM customers WHERE id=?").get(Number(req.params.customerId));
  if(!c) return res.status(404).json({error:"Customer not found"});
  const target=c.deal==="Rent"?"Rent":"Sale";
  const props=db.prepare("SELECT * FROM properties WHERE status='Available' AND deal=?").all(target);
  const matches=props.map(p=>{
    let score=0, reasons=[];
    if(p.type===c.type){score+=30;reasons.push("Type")}
    if(p.location.toLowerCase().includes(c.location.toLowerCase())||c.location.toLowerCase().includes(p.location.toLowerCase())){score+=40;reasons.push("Area")}
    if(c.bedrooms && p.bedrooms===c.bedrooms){score+=15;reasons.push("Bedrooms")}
    else if(c.bedrooms && p.bedrooms>=c.bedrooms){score+=8;reasons.push("Bedrooms close")}
    if(c.budget && p.budget<=c.budget){score+=15;reasons.push("Budget")}
    return {...p,score,reasons};
  }).filter(x=>x.score>=40).sort((a,b)=>b.score-a.score);
  res.json(matches);
});

app.get("/api/activity",auth,(req,res)=>{
  res.json(db.prepare(`SELECT a.*,COALESCE(u.name,'System') user_name FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100`).all());
});

app.get("/api/users",auth,admin,(req,res)=>{
  res.json(db.prepare("SELECT id,name,username,role,created_at FROM users ORDER BY id").all());
});
app.post("/api/users",auth,admin,(req,res)=>{
  const b=req.body;
  if(!clean(b.name)||!clean(b.username)||String(b.password||"").length<8) return res.status(400).json({error:"Name, username and password (8+ chars) required"});
  try{
    const hash=bcrypt.hashSync(String(b.password),12);
    const info=db.prepare("INSERT INTO users(name,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
      .run(clean(b.name),clean(b.username),hash,clean(b.role)||"partner",now());
    logActivity(req.session.user,"ADD","user",info.lastInsertRowid,`User ${b.username} created`);
    res.json({id:info.lastInsertRowid});
  }catch(e){res.status(400).json({error:"Username already exists"});}
});
app.delete("/api/users/:id",auth,admin,(req,res)=>{
  const id=Number(req.params.id);
  if(id===req.session.user.id) return res.status(400).json({error:"You cannot delete your own account"});
  db.prepare("DELETE FROM users WHERE id=?").run(id);
  logActivity(req.session.user,"DELETE","user",id,"User deleted"); res.json({ok:true});
});

app.post("/api/change-password",auth,(req,res)=>{
  const p=String(req.body.password||"");
  if(p.length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(p,12),req.session.user.id);
  logActivity(req.session.user,"PASSWORD","user",req.session.user.id,"Password changed");
  res.json({ok:true});
});

io.on("connection", socket=>{ socket.emit("connected",{time:now()}); });
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

server.listen(PORT,()=>console.log(`A.H State Agency Pro running on http://localhost:${PORT}`));
