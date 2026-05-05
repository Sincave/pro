<?php
session_start();
require_once 'db.php';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? $body['action'] ?? '';

switch ($action) {
case 'login':
    $u = queryOne("SELECT * FROM users WHERE username=? AND is_active=1",[clean($body['username']??'')]);
    if ($u && password_verify($body['password']??'',$u['password'])) {
        execute("UPDATE users SET last_login=NOW() WHERE id=?",[$u['id']]);
        $_SESSION = ['uid'=>$u['id'],'username'=>$u['username'],'full_name'=>$u['full_name'],'role'=>$u['role']];
        jsonResponse(true,['id'=>$u['id'],'username'=>$u['username'],'full_name'=>$u['full_name'],'role'=>$u['role']],'مرحباً '.$u['full_name']);
    } else jsonResponse(false,null,'بيانات خاطئة');

case 'logout':
    session_destroy(); jsonResponse(true,null,'تم الخروج');

case 'check':
    if (!empty($_SESSION['uid'])) jsonResponse(true,['id'=>$_SESSION['uid'],'username'=>$_SESSION['username'],'full_name'=>$_SESSION['full_name'],'role'=>$_SESSION['role']]);
    else jsonResponse(false,null,'غير مسجل');

case 'get_users':
    jsonResponse(true,query("SELECT id,username,full_name,role,is_active,last_login FROM users ORDER BY id"));

case 'add_user':
    $id=execute("INSERT INTO users (username,password,full_name,role) VALUES (?,?,?,?)",
        [clean($body['username']??''),password_hash($body['password']??'pass123',PASSWORD_DEFAULT),clean($body['full_name']??''),$body['role']??'worker']);
    jsonResponse(true,['id'=>$id],'تم إضافة المستخدم');

default: jsonResponse(false,null,'action غير معروف');
}
