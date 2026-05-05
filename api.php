<?php
require_once 'db.php';
$action = $_GET['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

switch ($action) {

// ── المنتجات ────────────────────────────────────────────
case 'get_products':
    $cat    = $_GET['category'] ?? '';
    $search = $_GET['search'] ?? '';
    $sort   = $_GET['sort'] ?? 'popular';
    $sql    = "SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.is_active=1";
    $params = [];
    if ($cat)    { $sql .= " AND p.category_id=?"; $params[] = $cat; }
    if ($search) { $sql .= " AND (p.name LIKE ? OR p.barcode=?)"; $params[] = "%$search%"; $params[] = $search; }
    $sql .= match($sort) {
        'price_asc'  => " ORDER BY p.selling_price ASC",
        'price_desc' => " ORDER BY p.selling_price DESC",
        'featured'   => " ORDER BY p.is_featured DESC, p.total_sold DESC",
        default      => " ORDER BY p.total_sold DESC",
    };
    jsonResponse(true, query($sql, $params));

case 'add_product':
    $imagePath = '';
    if (isset($_FILES['image']) && $_FILES['image']['error'] === 0) {
        $imagePath = uploadImage($_FILES['image'], 'product') ?? '';
    }
    $id = execute(
        "INSERT INTO products (name,description,barcode,category_id,purchase_price,selling_price,stock,min_stock,image_path,is_featured) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [clean($_POST['name']??''), clean($_POST['description']??''), clean($_POST['barcode']??''),
         (int)($_POST['category_id']??0), (float)($_POST['purchase_price']??0),
         (float)($_POST['selling_price']??0), (int)($_POST['stock']??0),
         (int)($_POST['min_stock']??5), $imagePath, (int)($_POST['is_featured']??0)]
    );
    jsonResponse(true, ['id'=>$id, 'image_path'=>$imagePath], 'تم إضافة المنتج');

case 'update_product':
    $id = (int)($_POST['id'] ?? 0);
    $product = queryOne("SELECT image_path FROM products WHERE id=?", [$id]);
    $imagePath = $product['image_path'] ?? '';
    if (isset($_FILES['image']) && $_FILES['image']['error'] === 0) {
        $new = uploadImage($_FILES['image'], 'product');
        if ($new) {
            if ($imagePath && file_exists(__DIR__ . '/' . $imagePath)) @unlink(__DIR__ . '/' . $imagePath);
            $imagePath = $new;
        }
    }
    execute(
        "UPDATE products SET name=?,description=?,barcode=?,category_id=?,purchase_price=?,selling_price=?,stock=?,min_stock=?,image_path=?,is_featured=? WHERE id=?",
        [clean($_POST['name']??''), clean($_POST['description']??''), clean($_POST['barcode']??''),
         (int)($_POST['category_id']??0), (float)($_POST['purchase_price']??0),
         (float)($_POST['selling_price']??0), (int)($_POST['stock']??0),
         (int)($_POST['min_stock']??5), $imagePath, (int)($_POST['is_featured']??0), $id]
    );
    jsonResponse(true, ['image_path'=>$imagePath], 'تم التحديث');

case 'delete_product':
    execute("UPDATE products SET is_active=0 WHERE id=?", [(int)($body['id']??0)]);
    jsonResponse(true, null, 'تم الحذف');

case 'get_categories':
    jsonResponse(true, query("SELECT * FROM categories WHERE is_active=1 ORDER BY sort_order"));

case 'add_category':
    $id = execute("INSERT INTO categories (name,icon,color) VALUES (?,?,?)",
        [clean($body['name']??''), clean($body['icon']??'📦'), clean($body['color']??'#6366f1')]);
    jsonResponse(true, ['id'=>$id], 'تم إضافة الفئة');

// ── الطلبات ─────────────────────────────────────────────
case 'create_order':
    $db = getDB(); $db->beginTransaction();
    try {
        $num   = 'ORD-'.date('Ymd').'-'.str_pad(query("SELECT COUNT(*)+1 as n FROM orders WHERE order_date=CURDATE()")[0]['n'],3,'0',STR_PAD_LEFT);
        $items = $body['items'] ?? [];
        $sub   = array_sum(array_map(fn($i)=>$i['unit_price']*$i['quantity'],$items));
        $dType = $body['discount_type']??'fixed'; $dVal=(float)($body['discount_value']??0);
        $dAmt  = $dType==='percent'?$sub*$dVal/100:$dVal;
        $tax   = ($sub-$dAmt)*(float)($body['tax_rate']??0)/100;
        $total = $sub-$dAmt+$tax;
        $paid  = (float)($body['amount_paid']??$total);

        $orderId = execute("INSERT INTO orders (order_number,customer_id,customer_name,customer_phone,order_type,delivery_address,subtotal,discount_type,discount_value,discount_amount,tax_rate,tax_amount,total,payment_method,payment_status,amount_paid,change_amount,order_status,notes,cashier_name,order_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())",
            [$num,$body['customer_id']??null,clean($body['customer_name']??'زبون'),clean($body['customer_phone']??''),$body['order_type']??'dine_in',clean($body['delivery_address']??''),$sub,$dType,$dVal,$dAmt,$body['tax_rate']??0,$tax,$total,$body['payment_method']??'cash',$body['payment_status']??'paid',$paid,max(0,$paid-$total),'pending',clean($body['notes']??''),clean($body['cashier_name']??'')]);

        foreach ($items as $item) {
            $prod = queryOne("SELECT purchase_price FROM products WHERE id=?",[(int)$item['id']]);
            $pp   = $prod['purchase_price']??0;
            $tp   = $item['unit_price']*$item['quantity'];
            execute("INSERT INTO order_items (order_id,product_id,product_name,quantity,purchase_price,unit_price,total_price,profit,notes) VALUES (?,?,?,?,?,?,?,?,?)",
                [$orderId,(int)$item['id'],clean($item['name']),(int)$item['quantity'],$pp,$item['unit_price'],$tp,($item['unit_price']-$pp)*$item['quantity'],clean($item['notes']??'')]);
            execute("UPDATE products SET stock=stock-?,total_sold=total_sold+? WHERE id=?",[(int)$item['quantity'],(int)$item['quantity'],(int)$item['id']]);
        }

        // تسجيل الدين تلقائياً
        if (($body['payment_method']??'')===('debt')) {
            execute("INSERT INTO debts (customer_id,customer_name,customer_phone,order_id,order_number,original_amount,remaining_amount,status,notes) VALUES (?,?,?,?,?,?,?,'pending',?)",
                [$body['customer_id']??null,clean($body['customer_name']??'زبون'),clean($body['customer_phone']??''),$orderId,$num,$total,$total,'دين من طلب '.$num]);
        }

        // تحديث الصندوق
        if (($body['payment_method']??'')!=='debt') {
            execute("UPDATE cash_register SET balance=balance+? WHERE id=1",[$total]);
        }

        $db->commit();
        jsonResponse(true,['order_id'=>$orderId,'order_number'=>$num,'total'=>$total,'change'=>max(0,$paid-$total)],'تم إنشاء الطلب');
    } catch(Exception $e) { $db->rollBack(); jsonResponse(false,null,$e->getMessage()); }

case 'get_orders':
    $period = $_GET['period']??'day'; $status = $_GET['status']??'';
    $sql    = "SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as items_count FROM orders o WHERE 1";
    $params = [];
    if ($period==='day')   { $sql.=" AND o.order_date=CURDATE()"; }
    elseif($period==='week')  { $sql.=" AND o.order_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)"; }
    elseif($period==='month') { $sql.=" AND MONTH(o.order_date)=MONTH(CURDATE()) AND YEAR(o.order_date)=YEAR(CURDATE())"; }
    if ($status) { $sql.=" AND o.order_status=?"; $params[]=$status; }
    $sql .= " ORDER BY o.created_at DESC";
    jsonResponse(true, query($sql,$params));

case 'get_order_items':
    jsonResponse(true, query("SELECT * FROM order_items WHERE order_id=?",[(int)($_GET['id']??0)]));

case 'update_order_status':
    execute("UPDATE orders SET order_status=? WHERE id=?",[$body['status'],$body['id']]);
    jsonResponse(true,null,'تم التحديث');

// ── الديون ──────────────────────────────────────────────
case 'get_debts':
    $status = $_GET['status']??'';
    $sql    = "SELECT * FROM debts";
    $params = [];
    if ($status) { $sql.=" WHERE status=?"; $params[]=$status; }
    $sql.=" ORDER BY created_at DESC";
    jsonResponse(true,query($sql,$params));

case 'add_debt':
    $id = execute("INSERT INTO debts (customer_name,customer_phone,original_amount,remaining_amount,due_date,notes) VALUES (?,?,?,?,?,?)",
        [clean($body['customer_name']??''),clean($body['customer_phone']??''),(float)($body['amount']??0),(float)($body['amount']??0),$body['due_date']??null,clean($body['notes']??'')]);
    jsonResponse(true,['id'=>$id],'تم تسجيل الدين');

case 'pay_debt':
    $debt = queryOne("SELECT * FROM debts WHERE id=?",[(int)($body['id']??0)]);
    if (!$debt) jsonResponse(false,null,'غير موجود');
    $newPaid = $debt['paid_amount']+(float)($body['amount']??0);
    $newRem  = max(0,$debt['original_amount']-$newPaid);
    $status  = $newRem<=0?'paid':($newPaid>0?'partial':'pending');
    execute("UPDATE debts SET paid_amount=?,remaining_amount=?,status=? WHERE id=?",[$newPaid,$newRem,$status,(int)($body['id']??0)]);
    execute("INSERT INTO debt_payments (debt_id,amount,notes) VALUES (?,?,?)",[(int)($body['id']??0),(float)($body['amount']??0),clean($body['notes']??'')]);
    // تحديث الصندوق
    execute("UPDATE cash_register SET balance=balance+? WHERE id=1",[(float)($body['amount']??0)]);
    jsonResponse(true,['remaining'=>$newRem,'status'=>$status],'تم تسجيل الدفع');

// ── العملاء ─────────────────────────────────────────────
case 'get_customers':
    $q = $_GET['search']??'';
    $sql = "SELECT * FROM customers";
    $params = [];
    if ($q) { $sql.=" WHERE name LIKE ? OR phone LIKE ?"; $params=["%$q%","%$q%"]; }
    $sql.=" ORDER BY name";
    jsonResponse(true,query($sql,$params));

case 'add_customer':
    $id=execute("INSERT INTO customers (name,phone,email,address,city,notes) VALUES (?,?,?,?,?,?)",
        [clean($body['name']??''),clean($body['phone']??''),clean($body['email']??''),clean($body['address']??''),clean($body['city']??''),clean($body['notes']??'')]);
    jsonResponse(true,['id'=>$id],'تم إضافة العميل');

// ── المصاريف + الصندوق ──────────────────────────────────
case 'get_expenses':
    $type  = $_GET['type']??'';
    $month = $_GET['month']??'';
    $sql   = "SELECT * FROM expenses WHERE 1";
    $params= [];
    if ($type)  { $sql.=" AND type=?"; $params[]=$type; }
    if ($month) { $sql.=" AND DATE_FORMAT(expense_date,'%Y-%m')=?"; $params[]=$month; }
    $sql.=" ORDER BY expense_date DESC";
    $expenses = query($sql,$params);
    $cash = queryOne("SELECT * FROM cash_register WHERE id=1");
    jsonResponse(true,['expenses'=>$expenses,'cash'=>$cash]);

case 'add_expense':
    $type   = $body['type']??'out';
    $amount = (float)($body['amount']??0);
    $id = execute("INSERT INTO expenses (title,amount,type,category,description,expense_date) VALUES (?,?,?,?,?,?)",
        [clean($body['title']??''),$amount,$type,clean($body['category']??'عام'),clean($body['description']??''),$body['date']??date('Y-m-d')]);
    // تحديث الصندوق
    if ($type==='out') execute("UPDATE cash_register SET balance=balance-? WHERE id=1",[$amount]);
    else               execute("UPDATE cash_register SET balance=balance+? WHERE id=1",[$amount]);
    jsonResponse(true,['id'=>$id],'تم إضافة المصروف');

case 'delete_expense':
    $exp = queryOne("SELECT * FROM expenses WHERE id=?",[(int)($body['id']??0)]);
    if ($exp) {
        if ($exp['type']==='out') execute("UPDATE cash_register SET balance=balance+? WHERE id=1",[$exp['amount']]);
        else execute("UPDATE cash_register SET balance=balance-? WHERE id=1",[$exp['amount']]);
        execute("DELETE FROM expenses WHERE id=?",[($exp['id'])]);
    }
    jsonResponse(true,null,'تم الحذف');

case 'set_capital':
    $cap = (float)($body['capital']??0);
    execute("UPDATE cash_register SET initial_capital=?,balance=? WHERE id=1",[$cap,$cap]);
    jsonResponse(true,null,'تم تعيين رأس المال');

// ── الإحصائيات ──────────────────────────────────────────
case 'get_stats':
    $period = $_GET['period']??'day';
    $df = match($period) {
        'week'  => "o.order_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)",
        'month' => "MONTH(o.order_date)=MONTH(CURDATE()) AND YEAR(o.order_date)=YEAR(CURDATE())",
        default => "o.order_date=CURDATE()",
    };
    $sales  = queryOne("SELECT COUNT(*) as cnt,COALESCE(SUM(total),0) as revenue FROM orders o WHERE $df AND order_status!='cancelled'");
    $profit = queryOne("SELECT COALESCE(SUM(oi.profit),0) as profit FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE $df AND o.order_status!='cancelled'");
    $top    = query("SELECT oi.product_name,SUM(oi.quantity) as qty,SUM(oi.total_price) as rev FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE $df AND o.order_status!='cancelled' GROUP BY oi.product_name ORDER BY qty DESC LIMIT 5");
    $debts  = queryOne("SELECT COALESCE(SUM(remaining_amount),0) as total,COUNT(*) as cnt FROM debts WHERE status!='paid'");
    $weekly = query("SELECT order_date,SUM(total) as revenue,COUNT(*) as orders FROM orders WHERE order_date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND order_status!='cancelled' GROUP BY order_date ORDER BY order_date");
    $low    = query("SELECT name,stock,min_stock FROM products WHERE stock<=min_stock AND is_active=1 ORDER BY stock");
    // تحليل الأيام الضعيفة
    $weak   = query("SELECT order_date,SUM(total) as revenue,COUNT(*) as orders_count FROM orders WHERE order_status!='cancelled' AND order_date>=DATE_SUB(CURDATE(),INTERVAL 90 DAY) GROUP BY order_date ORDER BY revenue ASC LIMIT 10");
    // تحليل الأشهر
    $monthly= query("SELECT DATE_FORMAT(order_date,'%Y-%m') as month,SUM(total) as revenue,COUNT(*) as orders FROM orders WHERE order_status!='cancelled' GROUP BY month ORDER BY month DESC LIMIT 12");
    $cash   = queryOne("SELECT * FROM cash_register WHERE id=1");
    jsonResponse(true,['sales'=>$sales,'profit'=>$profit,'top'=>$top,'debts'=>$debts,'weekly'=>$weekly,'low_stock'=>$low,'weak_days'=>$weak,'monthly'=>$monthly,'cash'=>$cash]);

// ── الإعدادات ────────────────────────────────────────────
case 'get_settings':
    $rows = query("SELECT setting_key,setting_value FROM settings");
    $out  = []; foreach($rows as $r) $out[$r['setting_key']]=$r['setting_value'];
    jsonResponse(true,$out);

case 'save_settings':
    foreach ($body as $k=>$v) {
        execute("INSERT INTO settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?",[clean($k),clean($v),clean($v)]);
    }
    jsonResponse(true,null,'تم الحفظ');

case 'upload_logo':
    if (isset($_FILES['logo']) && $_FILES['logo']['error']===0) {
        $path = uploadImage($_FILES['logo'],'logo');
        if ($path) {
            execute("INSERT INTO settings (setting_key,setting_value) VALUES ('logo_path',?) ON DUPLICATE KEY UPDATE setting_value=?",[$path,$path]);
            jsonResponse(true,['path'=>$path],'تم رفع الشعار');
        }
    }
    jsonResponse(false,null,'فشل رفع الصورة');

case 'verify_secret':
    $s = queryOne("SELECT setting_value FROM settings WHERE setting_key='secret_password'");
    jsonResponse($s && $s['setting_value']===$body['password'], null, $s && $s['setting_value']===$body['password']?'ok':'خطأ');

case 'backup':
    $out = [];
    foreach(['categories','products','customers','orders','order_items','debts','expenses','settings'] as $t)
        $out[$t] = query("SELECT * FROM $t");
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="backup_'.date('Y-m-d').'.json"');
    echo json_encode($out,JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT); exit;

default:
    jsonResponse(false,null,'action غير معروف: '.$action);
}
