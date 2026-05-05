<?php
// upload.php - رفع الصور (مساعد)
require_once 'db.php';
header('Content-Type: application/json; charset=utf-8');

$type = $_GET['type'] ?? 'product'; // product | logo

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== 0) {
    echo json_encode(['success'=>false,'message'=>'لم يتم رفع أي ملف']);
    exit;
}

$prefix = $type === 'logo' ? 'logo' : 'product';
$path   = uploadImage($_FILES['file'], $prefix);

if ($path) {
    if ($type === 'logo') {
        execute("INSERT INTO settings (setting_key,setting_value) VALUES ('logo_path',?) ON DUPLICATE KEY UPDATE setting_value=?", [$path, $path]);
    }
    echo json_encode(['success'=>true, 'path'=>$path, 'url'=>$path]);
} else {
    echo json_encode(['success'=>false, 'message'=>'فشل رفع الصورة. تأكد من النوع (JPG/PNG) والحجم (أقل من 5MB)']);
}
