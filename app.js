// ==========================================
// 1. 全局配置与初始化
// ==========================================
const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
const supabaseUrl = isLocal 
    ? 'https://yjamftvgrlojuryyhlqy.supabase.co' 
    : window.location.origin + '/supabase-api';
const supabaseKey = 'sb_publishable_Gv9Nq68wUKC3ZzKNPgi4FQ_K_5U-X7x';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// 🌟 限制地图的边界 (西华大学郫都校区大致范围)
const bounds = L.latLngBounds(
    [30.765, 103.930], // 左下角 (西南)
    [30.805, 103.990]  // 右上角 (东北)
);

// 初始化地图时加入 maxBounds 和 缩放限制
var map = L.map('map', { 
    zoomControl: false, 
    doubleClickZoom: false,
    maxBounds: bounds,        // 🌟 限制边界
    maxBoundsViscosity: 1.0,  // 🌟 拖动超出边界时的“橡皮筋”粘度，1.0表示完全拖不出去
    minZoom: 14,              // 🌟 最小缩放级别（防止缩得太小看到全地球）
    maxZoom: 19               // 🌟 最大缩放级别
}).setView([30.785, 103.961], 16);


delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    subdomains: ['1', '2', '3', '4'], attribution: '© 高德地图'
}).addTo(map);

// 全局状态变量
let allLocations = [];
let allMarkers = [];
let currentCategory = '全部'; 
let currentKeyword = '';      
let markerMap = {};         
let currentOnlineType = '全部';
let currentZone = '全部区域'; 
let currentSortOrder = 'newest'; 
let currentLocationId = null; // 全局记录当前正在看哪家店
let currentDishesData = []; // 全局暂存当前店铺的所有菜品
let currentUserId = null; // 🌟 全局记录当前用户的ID
let allDishesList = []; // 存全库的菜品供抽奖用
// 🌟 新增：创建一个聚合图层组
let markerClusterGroup = L.markerClusterGroup({
    maxClusterRadius: 50, // 聚合的最大半径（像素），越大越容易聚在一起
    spiderfyOnMaxZoom: true, // 放大到最大时，如果还在一起，就散开
    showCoverageOnHover: false // 鼠标悬浮时不显示范围，保持清爽
});
// 将聚合组直接加入地图
map.addLayer(markerClusterGroup);
// 初始化 Supabase 后，立刻检查登录状态
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
        // 如果没有登录，就悄悄调用匿名登录
        const { error } = await supabaseClient.auth.signInAnonymously();
        if (error) console.error("匿名登录失败:", error);
        else {
            console.log("已获取匿名身份，可以发言啦！");
            // 登录成功后立刻拿一次ID
            const { data } = await supabaseClient.auth.getSession();
            currentUserId = data.session.user.id; 
        }
    } else {
        console.log("已有身份:", session.user.id);
        currentUserId = session.user.id; 
    }
}
// ==========================================
// 带重试机制的图片上传工具函数
// ==========================================
async function uploadWithRetry(file, path, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const { data, error } = await supabaseClient.storage.from('food_images').upload(path, file);
            if (!error) return data; // 成功就直接返回
            console.warn(`第 ${i + 1} 次上传失败，准备重试...`);
        } catch (err) {
            console.error(`第 ${i + 1} 次上传异常:`, err);
            if (i === maxRetries - 1) throw err; // 最后一次还失败，就真的抛出错误
            await new Promise(res => setTimeout(res, 2000)); // 等待2秒再试
        }
    }
    throw new Error('重试多次后仍失败，请检查网络');
}
initAuth(); // 执行登录
// ==========================================
// 坐标系转换工具 (WGS84 转 GCJ-02)
// ==========================================
const PI = 3.1415926535897932384626;
const a = 6378245.0;
const ee = 0.00669342162296594323;

function transformLat(lng, lat) {
    let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
    ret += (20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(lat * PI) + 40.0 * Math.sin(lat / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(lat / 12.0 * PI) + 320 * Math.sin(lat * PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLng(lng, lat) {
    let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
    ret += (20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(lng * PI) + 40.0 * Math.sin(lng / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(lng / 12.0 * PI) + 300.0 * Math.sin(lng / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
}

// 核心转换函数：传入 GPS 坐标，返回高德坐标
function wgs84ToGcj02(lng, lat) {
    let dlat = transformLat(lng - 105.0, lat - 35.0);
    let dlng = transformLng(lng - 105.0, lat - 35.0);
    let radlat = lat / 180.0 * PI;
    let magic = Math.sin(radlat);
    magic = 1 - ee * magic * magic;
    let sqrtmagic = Math.sqrt(magic);
    dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * PI);
    dlng = (dlng * 180.0) / (a / sqrtmagic * Math.cos(radlat) * PI);
    let mglat = lat + dlat;
    let mglng = lng + dlng;
    return [mglng, mglat]; // 返回 [经度, 纬度]
}

// ==========================================
// 2. 数据获取层
// ==========================================
async function fetchDataFromCloud(retryCount = 0) {
    try {
         const { data, error } = await supabaseClient
            .from('locations')
            .select('*')
            .eq('is_deleted', false); 
        if (error) throw error; 
        
        allLocations = data;
        
         // 拉取所有菜品，供盲盒使用
        const { data: dishData } = await supabaseClient.from('dishes').select('*').eq('is_deleted', false);
        if (dishData) allDishesList = dishData;

        // 🌟 新增：动态生成区域下拉菜单的 <li>
        const zoneMenu = document.getElementById('zone-menu');
        zoneMenu.innerHTML = '<li class="dropdown-item active" data-value="全部区域">全部区域</li>';
        
        const uniqueZones = [...new Set(allLocations.map(item => item.zone).filter(z => z && z.trim() !== ''))];
        
        uniqueZones.forEach(z => {
            const li = document.createElement('li');
            li.className = 'dropdown-item';
            li.dataset.value = z;
            li.innerText = z;
            zoneMenu.appendChild(li);
        });

        // 重置状态
        document.getElementById('zone-trigger-text').innerText = '全部区域';
        currentZone = '全部区域';
        document.getElementById('category-trigger-text').innerText = '全部分类';
        currentCategory = '全部';

         // 🌟 新增：拉取公告
        const { data: settingData, error: settingError } = await supabaseClient
            .from('app_settings')
            .select('value')
            .eq('key', 'announcement')
            .single(); // 只要一条
        
        if (!settingError && settingData) {
            document.getElementById('announcement-text').innerText = settingData.value;
        } else {
            document.getElementById('announcement-text').innerText = "暂无最新公告。";
        }
        renderAll(); 
        
        let errorTip = document.getElementById('net-error-tip');
        if (errorTip) errorTip.remove();

    } catch (err) {
        console.error(`数据拉取失败 (尝试第 ${retryCount + 1} 次):`, err);
        if (retryCount < 3) {
            showNetErrorTip("网络好像有点波动，正在努力加载中...");
            setTimeout(() => fetchDataFromCloud(retryCount + 1), 2000); 
        } else {
            showNetErrorTip("网络开小差了，请刷新页面重试哦~", true);
        }
    }
}

function showNetErrorTip(msg, isFinal = false) {
    let tip = document.getElementById('net-error-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'net-error-tip';
        tip.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 15px 25px; border-radius: 10px; z-index: 9999; font-size: 14px; text-align: center;`;
        document.body.appendChild(tip);
    }
    tip.innerHTML = msg;
    if (isFinal) tip.innerHTML += '<br><br><button onclick="location.reload()" style="padding:5px 15px; border-radius:5px; border:none; cursor:pointer;">刷新页面</button>';
}

// ==========================================
// 3. 渲染层
// ==========================================
function renderAll() {
    // 1. 清理旧的标记（从聚合组和地图中移除）
    markerClusterGroup.clearLayers();
    markerMap = {};

    let filtered = allLocations;
    if (currentZone !== '全部区域') {
        filtered = filtered.filter(item => item.zone === currentZone);
    }
    if (currentCategory !== '全部') filtered = filtered.filter(item => item.category === currentCategory);
    if (currentOnlineType !== '全部') filtered = filtered.filter(item => item.is_online === currentOnlineType);
    if (currentKeyword.trim() !== '') {
        filtered = filtered.filter(item => 
            (item.name && item.name.toLowerCase().includes(currentKeyword.toLowerCase())) ||
            (item.desc && item.desc.toLowerCase().includes(currentKeyword.toLowerCase())) ||
            (item.zone && item.zone.toLowerCase().includes(currentKeyword.toLowerCase()))
        );
    }

    filtered.forEach(item => {
        if (item.is_online === '仅线上') return; 
        let lat = parseFloat(item.lat), lng = parseFloat(item.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        let marker = L.marker([lat, lng]);
        markerMap[item.id] = marker;

        const onlineMap = { '仅线上': '🌐 仅线上', '仅线下': '🏠 仅线下', '线上线下都有': '🏢 线上线下' };
        let onlineTag = onlineMap[item.is_online] || '❓ 未知';
        
        let popupContent = `
            <div style="font-family: sans-serif; max-width: 250px;">
                <h3 style="margin: 0 0 5px 0;">${item.name}</h3>
                <span style="color: gray; font-size: 13px;">区域：${item.zone || '未分类'} | 分类：${item.category} | ${onlineTag}</span><br>
                <p style="margin: 10px 0; padding: 8px; background: #f5f5f5; border-radius: 5px; font-size: 14px;">
                    ${item.desc || '暂无简介'}
                </p>
                <div style="border-top: 1px dashed #ccc; padding-top: 5px;">
                    <span style="color: #ff5722; font-weight: bold;">❤️ 店铺赞：${item.likes || 0} 个</span>
                </div>
            </div>
        `;
        marker.bindPopup(popupContent);
        marker.on('dblclick', function(e) {
            L.DomEvent.stopPropagation(e);
            map.closePopup();
            openDetailCard(item);
        });
        markerClusterGroup.addLayer(marker);
    });

    renderList(filtered);
}

function renderList(dataList) {
    let listContent = document.getElementById('list-content');
    listContent.innerHTML = ''; 

    let sortedList = [...dataList].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));

    sortedList.forEach(item => {
        let div = document.createElement('div');
        div.className = 'list-item';
        
        let isOnlineOnly = item.is_online === '仅线上';
        let btnClass = isOnlineOnly ? 'locate-btn disabled' : 'locate-btn';
        
        let displayName = item.zone ? `${item.name} (${item.zone})` : item.name;
        
        div.innerHTML = `
            <div class="list-item-info">
                <span class="list-item-name">${displayName}</span>
                <span class="list-item-meta">${item.category}</span>
            </div>
            <button class="${btnClass}"><div class="locate-icon"></div></button>
        `;
        
        div.querySelector('.list-item-info').onclick = () => openDetailCard(item);
        
        div.querySelector('.locate-btn').onclick = (e) => {
            e.stopPropagation(); 
            if (isOnlineOnly) return;
            toggleDrawer(false); 
            map.flyTo([parseFloat(item.lat), parseFloat(item.lng)], 17, { duration: 1.5 });
            setTimeout(() => {
                let targetMarker = markerMap[item.id];
                if (targetMarker) targetMarker.openPopup();
            }, 1500);
        };
        
        listContent.appendChild(div);
    });
}

// ==========================================
// 4. 交互与 UI 事件层
// ==========================================

async function openDetailCard(item) {
    const modal = document.getElementById('detail-modal');
    document.getElementById('modal-title').innerText = item.name;
    document.getElementById('modal-info').innerText = `区域：${item.zone || '未分类'} | 分类：${item.category} | ${item.is_online || '未知'}`;
    document.getElementById('modal-desc').innerText = `✨ 本店特色：${item.desc || '暂无补充'}`;
    document.getElementById('edit-desc-input').value = item.desc === "暂无特色，等你来补充！" ? "" : (item.desc || "");
    
    document.getElementById('desc-display-area').style.display = 'block';
    document.getElementById('desc-edit-area').style.display = 'none';
    
    //初始化店铺点赞按钮状态
    const likeBtn = document.getElementById('shop-like-btn');
    const likeCountSpan = document.getElementById('shop-like-count');
    
    // 展示当前的点赞数
    likeCountSpan.innerText = item.likes || 0;
    
    // 判断本地是否已经点过赞
    const likedShops = JSON.parse(localStorage.getItem('liked_shops') || '[]');
    if (likedShops.includes(item.id)) {
        likeBtn.classList.add('liked');
        likeBtn.innerHTML = `已推荐 (<span id="shop-like-count">${item.likes || 0}</span>)`;
    } else {
        likeBtn.classList.remove('liked');
        likeBtn.innerHTML = `👍 推荐这家店 (<span id="shop-like-count">${item.likes || 0}</span>)`;
    }

    currentLocationId = item.id; 
    modal.classList.remove('hidden');

    const savedNickname = localStorage.getItem('user_nickname');
    if (savedNickname) document.getElementById('comment-nickname').value = savedNickname;

    // 联系方式与环境图逻辑
    const extraInfoDiv = document.getElementById('shop-extra-info');
    const envImg = document.getElementById('shop-env-img');
    
    if (item.contact_info) {
        extraInfoDiv.innerHTML = `📞 联系方式/外卖平台：${item.contact_info}`;
        extraInfoDiv.style.display = 'block';
    } else {
        extraInfoDiv.style.display = 'none';
    }

   if (item.env_image_url) {
        // 用逗号切分成数组
        window.currentGalleryImages = item.env_image_url.split(',');
        // 默认展示第一张作为封面
        envImg.src = window.currentGalleryImages[0];
        envImg.style.display = 'block';
    } else {
        envImg.style.display = 'none';
    }

    fetchComments(item.id);
    setTimeout(() => {
        fetchDishes(item.id);
    }, 50);
}

document.getElementById('close-modal').onclick = () => document.getElementById('detail-modal').classList.add('hidden');

let isDrawerOpen = false;
function toggleDrawer(forceState = null) {
    let panel = document.getElementById('app-panel');
    let arrow = document.getElementById('arrow-icon');
    if (forceState !== null) isDrawerOpen = forceState;
    else isDrawerOpen = !isDrawerOpen;

    if (isDrawerOpen) {
        panel.classList.add('open');
        arrow.innerText = '▲'; 
    } else {
        panel.classList.remove('open');
        arrow.innerText = '▼'; 
    }
}
// 拉取评论
async function fetchComments(locationId) {
    const list = document.getElementById('comments-list');
    list.innerHTML = '<p style="color: #888; font-size: 13px; text-align: center;">加载评论中...</p>';

    // 构建查询
   let query = supabaseClient
        .from('comments')
        .select('*')
        .eq('location_id', locationId)
        .eq('is_deleted', false); 
    
    // 根据排序状态拼接查询条件
    if (currentSortOrder === 'newest') {
        query = query.order('created_at', { ascending: false });
    } else {
        // 最热：先按点赞数降序，点赞相同的按时间降序
        query = query.order('likes', { ascending: false }).order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
        console.error("拉取评论失败:", error);
        list.innerHTML = '<p style="color: red; font-size: 13px;">评论加载失败</p>';
        return;
    }

    if (data.length === 0) {
        list.innerHTML = '<p style="color: #888; font-size: 13px; text-align: center;">暂无评论，快来抢沙发！</p>';
        return;
    }

    list.innerHTML = ''; 
    
    // 获取本地记录的点过赞的评论ID列表
    const likedComments = JSON.parse(localStorage.getItem('liked_comments') || '[]');

    data.forEach(comment => {
        const date = new Date(comment.created_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
        
        const div = document.createElement('div');
        div.className = 'comment-item';
        
        // 头部（昵称、时间、点赞）
        const header = document.createElement('div');
        header.className = 'comment-header';
        
        const userSpan = document.createElement('span');
        userSpan.className = 'comment-user';
        userSpan.textContent = comment.nickname || '热心校友'; 
        
        // 右侧容器（放时间和点赞）
        const rightDiv = document.createElement('div');
        rightDiv.style.display = 'flex';
        rightDiv.style.alignItems = 'center';

        const dateSpan = document.createElement('span');
        dateSpan.textContent = date;

        rightDiv.appendChild(dateSpan);

        // 🌟 新增：判断这条评论是不是我自己发的
        if (comment.user_id === currentUserId) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '🗑️';
            delBtn.className = 'delete-comment-btn'; 
            delBtn.title = "删除我的评论";
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm("确定要删除这条评论吗？")) return;
                // 核心：软删除
                const { error } = await supabaseClient.from('comments').update({ is_deleted: true }).eq('id', comment.id);
                if (!error) {
                    fetchComments(currentLocationId); // 重新拉取评论列表
                } else {
                    alert("删除失败");
                }
            };
            rightDiv.appendChild(delBtn);
        }
        // 🌟 点赞按钮
        const likeBtn = document.createElement('button');
        const hasLiked = likedComments.includes(comment.id);
        likeBtn.className = `like-btn ${hasLiked ? 'liked' : ''}`;
        likeBtn.innerHTML = `👍 <span>${comment.likes || 0}</span>`;
        
        // 点赞点击事件
        likeBtn.onclick = async () => {
            if (likeBtn.classList.contains('liked')) return; // 点过了就别点了
            
            likeBtn.classList.add('liked');
            const span = likeBtn.querySelector('span');
            span.textContent = parseInt(span.textContent) + 1;

            // 记录到本地，防止刷新后重复点赞
            let currentLiked = JSON.parse(localStorage.getItem('liked_comments') || '[]');
            currentLiked.push(comment.id);
            localStorage.setItem('liked_comments', JSON.stringify(currentLiked));

            // 更新云端数据库
            await supabaseClient
                .from('comments')
                .update({ likes: (comment.likes || 0) + 1 })
                .eq('id', comment.id);
        };

        rightDiv.appendChild(dateSpan);
        rightDiv.appendChild(likeBtn);
        
        header.appendChild(userSpan);
        header.appendChild(rightDiv);
        
        // 内容
        const textDiv = document.createElement('div');
        textDiv.className = 'comment-text';
        textDiv.textContent = comment.content; 
        
        div.appendChild(header);
        div.appendChild(textDiv);
        list.appendChild(div);
    });
}

// 🌟 切换排序选项卡
function changeSort(order, btnElement) {
    currentSortOrder = order;
    // 切换按钮样式
    document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    // 重新拉取评论
    if (currentLocationId) fetchComments(currentLocationId);
}

// 提交评论
document.getElementById('submit-comment-btn').onclick = async function() {
    const nicknameInput = document.getElementById('comment-nickname').value.trim();
    const contentInput = document.getElementById('comment-input').value.trim();

    if (!contentInput) {
        alert("评论内容不能为空哦！");
        return;
    }

    // 如果没填昵称，给个默认的
    const finalNickname = nicknameInput || '热心校友';
    localStorage.setItem('user_nickname', finalNickname); // 记住昵称

    this.disabled = true;
    this.innerText = "发送中...";

     const newComment = {
        location_id: currentLocationId,
        content: contentInput,
        nickname: finalNickname 
    };

    try {
        const { error } = await supabaseClient.from('comments').insert([newComment]);
        if (error) throw error;

        document.getElementById('comment-input').value = ''; // 清空输入框
        fetchComments(currentLocationId); // 重新拉取评论
    } catch (error) {
        console.error("发送评论失败:", error);
        alert("网络异常，评论发送失败。请检查网络或数据库权限。");
    } finally {
        this.disabled = false;
        this.innerText = "发送评论";
    }
};
document.getElementById('drag-handle').onclick = () => toggleDrawer();

document.getElementById('search-input').addEventListener('input', function(e) {
    currentKeyword = e.target.value.trim();
    renderAll();
});

function filterCategory(category, btnElement) {
    document.querySelectorAll('#filter-bar button').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active'); 
    currentCategory = category;
    renderAll(); 
}

function filterOnline(type, btnElement) {
    document.querySelectorAll('#online-filter-bar button').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active'); 
    currentOnlineType = type;
    renderAll(); 
}

// ==========================================
// 4.5 添加新地点逻辑 (纯手动 + GPS + 区域查重)
// ==========================================
let tempLat = null; 
let tempLng = null; 

// 监听区域变化：动态提示该区域已有的店
document.getElementById('add-zone').addEventListener('change', function(e) {
    const customInput = document.getElementById('custom-zone-input');
    const tipDiv = document.getElementById('existing-shops-tip');
    
    if (e.target.value === 'custom') {
        customInput.style.display = 'block';
        tipDiv.innerHTML = ''; // 自定义区域清空提示
    } else {
        customInput.style.display = 'none';
        
        // 如果选了大区域，查一下这个区域里已经有什么店
        const selectedZone = e.target.value;
        if (selectedZone) {
            const shopsInZone = allLocations.filter(item => item.zone === selectedZone).map(item => item.name);
            if (shopsInZone.length > 0) {
                // 去重并拼接
                const uniqueShops = [...new Set(shopsInZone)].join('、');
                tipDiv.innerHTML = `💡 地图上【${selectedZone}】已有：${uniqueShops}`;
                tipDiv.style.color = "#FF9800"; 
            } else {
                tipDiv.innerHTML = `🎉 该区域暂无其他店铺，欢迎第一个添加！`;
                tipDiv.style.color = "#4CAF50";
            }
        } else {
            tipDiv.innerHTML = '';
        }
    }
});


document.getElementById('close-add-modal').onclick = () => {
    document.getElementById('add-modal').classList.add('hidden');
};
// 控制添加表单中联系方式和环境图的显示逻辑
function updateAddFormVisibility() {
    const isOnline = document.getElementById('add-is-online').value;
    const contactGroup = document.getElementById('contact-group');
    const envImgGroup = document.getElementById('env-image-group');

    if (isOnline === '仅线下') {
        contactGroup.style.display = 'none';      // 隐藏联系方式
        envImgGroup.style.display = 'block';      // 显示环境图
    } else if (isOnline === '仅线上') {
        contactGroup.style.display = 'block';     // 显示联系方式
        envImgGroup.style.display = 'none';       // 隐藏环境图
    } else {
        contactGroup.style.display = 'block';     // 线上线下都有：都显示
        envImgGroup.style.display = 'block';
    }
}
document.getElementById('add-is-online').addEventListener('change', function(e) {
    const statusText = document.getElementById('add-location-status');
    // 控制定位提示的显示
    if (e.target.value === '仅线上') {
        statusText.style.display = 'none'; 
    } else {
        statusText.style.display = 'block'; 
    }
    // 联动控制联系方式与环境图的显示
    updateAddFormVisibility();
});

// 提交表单
document.getElementById('submit-place-btn').onclick = async function() {
    const name = document.getElementById('add-name').value.trim();
    const category = document.getElementById('add-category').value;
    const isOnline = document.getElementById('add-is-online').value;
    const feature = document.getElementById('add-feature').value.trim(); 
    const contact = document.getElementById('add-contact').value.trim();
    const envFiles = document.getElementById('add-env-image').files; 
    let zone = document.getElementById('add-zone').value;

    if (!name) return alert("店名不能为空哦！");
    if (!zone) return alert("请选择一个所属区域！");
    if (zone === 'custom') {
        zone = document.getElementById('custom-zone-input').value.trim();
        if (!zone) return alert("请输入自定义区域名称！");
    }

    // 查重逻辑
    const isDuplicate = allLocations.some(item => 
        item.name.toLowerCase() === name.toLowerCase() && item.zone === zone
    );
    if (isDuplicate) {
        alert(`⚠️ 提示：【${zone}】已经存在名为“${name}”的店铺啦！`);
        return;
    }

    if (tempLat === null || tempLng === null) return alert("还在获取位置，请稍等~");

    this.disabled = true;
    this.innerText = "正在上传...";
    let envImageUrlString = null; 

    try {
        // 🌟 核心：多图上传逻辑
        if (envFiles.length > 0) {
            this.innerText = `正在上传 ${envFiles.length} 张图片...`;
            
            // 用 Promise.all 并发上传所有图片
            const uploadPromises = Array.from(envFiles).map(async (file) => {
                const options = { maxSizeMB: 0.5, maxWidthOrHeight: 800, useWebWorker: true };
                const compressedFile = await imageCompression(file, options);
                const fileExt = compressedFile.name.split('.').pop();
                const fileName = `env_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                await uploadWithRetry(compressedFile, fileName);
                const { data: publicUrlData } = supabaseClient.storage.from('food_images').getPublicUrl(fileName);
                return publicUrlData.publicUrl;
            });

            const urlArray = await Promise.all(uploadPromises);
            // 将数组用逗号拼成字符串，存入数据库
            envImageUrlString = urlArray.join(','); 
        }

        let finalLat = tempLat;
        let finalLng = tempLng;
        if (isOnline === '仅线上') {
            finalLat = 30.78; 
            finalLng = 103.95;
        }

        const newLocation = {
            name: name,
            category: category,
            zone: zone, 
            is_online: isOnline,
            desc: feature || "暂无特色，等你来补充！",
            lat: finalLat,
            lng: finalLng,
            likes: 0,
            contact_info: contact || null,    // 🌟 新增
            env_image_url: envImageUrlString || null  // 🌟 新增
        };

        const { data, error } = await supabaseClient.from('locations').insert([newLocation]);
        if (error) throw error;

        alert("🎉 添加成功！");
        
        // 清空表单
        document.getElementById('add-name').value = '';
        document.getElementById('add-feature').value = '';
        document.getElementById('add-contact').value = '';
        document.getElementById('add-env-image').value = '';
        document.getElementById('add-modal').classList.add('hidden');

        fetchDataFromCloud();

    } catch (error) {
        console.error("添加失败：", error);
        alert("添加失败：" + error.message);
    } finally {
        this.disabled = false;
        this.innerText = "提交并保存到云端";
    }
};
// ==========================================
// 6. 个人中心逻辑 (我的评论)
// ==========================================


// 关闭个人中心
document.getElementById('close-profile-modal').onclick = () => {
    document.getElementById('profile-modal').classList.add('hidden');
};

// 获取并渲染我的评论
async function fetchMyComments() {
    const list = document.getElementById('my-comments-list');
    list.innerHTML = '<p style="text-align:center; color:#888; font-size:14px;">加载中...</p>';

    // 1. 获取当前匿名用户的 ID
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return; // 如果没登录，直接返回

    const myUserId = session.user.id;

    // 2. 去数据库里查出 user_id 等于我的所有评论 (按时间倒序)
    const { data, error } = await supabaseClient
        .from('comments')
        .select('*')
        .eq('user_id', myUserId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("获取我的评论失败:", error);
        list.innerHTML = '<p style="text-align:center; color:red;">加载失败</p>';
        return;
    }

    if (data.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#888; font-size:14px; margin-top:20px;">你还没有发表过评论哦~</p>';
        return;
    }

    // 3. 渲染列表
    list.innerHTML = '';
    data.forEach(comment => {
        // 找到这条评论对应的店铺名字 (利用我们前面的 allLocations 数组)
        const shop = allLocations.find(loc => loc.id === comment.location_id);
        const shopName = shop ? shop.name : '未知店铺';
        
        const date = new Date(comment.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

        const div = document.createElement('div');
        div.className = 'my-comment-item';

        // 左半部分：内容、店铺名、时间
        const infoDiv = document.createElement('div');
        infoDiv.className = 'my-comment-content';
        infoDiv.innerHTML = `
            <div class="my-comment-shop">📍 ${shopName}</div>
            <div style="margin: 4px 0;">${comment.content}</div>
            <div class="my-comment-date">${date}</div>
        `;

        // 右半部分：删除按钮
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-comment-btn';
        delBtn.innerText = '删除';
        
        // 🌟 删除评论逻辑
        delBtn.onclick = async () => {
            if (!confirm("确定要删除这条评论吗？")) return;
            
            delBtn.innerText = '删除中...';
            delBtn.disabled = true;

            // 向云端发送删除请求，必须同时匹配 评论ID 和 你的用户ID（防止误删别人的）
            const { error: delError } = await supabaseClient
                .from('comments')
                .delete()
                .match({ id: comment.id, user_id: myUserId });

            if (delError) {
                console.error("删除失败:", delError);
                alert("删除失败，请稍后再试。");
                delBtn.innerText = '删除';
                delBtn.disabled = false;
            } else {
                // 删除成功，重新拉取列表刷新
                fetchMyComments();
            }
        };

        div.appendChild(infoDiv);
        div.appendChild(delBtn);
        list.appendChild(div);
    });
}
// ==========================================
// 7. 修改本店特色逻辑
// ==========================================

// 点击“修改特色”按钮
document.getElementById('edit-desc-btn').onclick = function() {
    document.getElementById('desc-display-area').style.display = 'none';
    document.getElementById('desc-edit-area').style.display = 'block';
    document.getElementById('edit-desc-input').focus();
};

// 点击“取消”按钮
document.getElementById('cancel-desc-btn').onclick = function() {
    document.getElementById('desc-display-area').style.display = 'block';
    document.getElementById('desc-edit-area').style.display = 'none';
};

// 点击“保存特色”按钮
document.getElementById('save-desc-btn').onclick = async function() {
    const newDesc = document.getElementById('edit-desc-input').value.trim();
    
    // 如果用户没填，就不让保存
    if (!newDesc) {
        alert("特色内容不能为空哦！");
        return;
    }

    this.disabled = true;
    this.innerText = "保存中...";

    try {
        // 1. 更新云端数据库的 locations 表
        const { error } = await supabaseClient
            .from('locations')
            .update({ desc: newDesc })
            .eq('id', currentLocationId);

        if (error) throw error;

        // 2. 如果更新成功，修改本地 allLocations 里的数据，避免刷新
        const targetLoc = allLocations.find(loc => loc.id === currentLocationId);
        if (targetLoc) targetLoc.desc = newDesc;

        // 3. 更新 UI 界面
        document.getElementById('modal-desc').innerText = `✨ 本店特色：${newDesc}`;
        document.getElementById('desc-display-area').style.display = 'block';
        document.getElementById('desc-edit-area').style.display = 'none';

        // 4. 因为 store 名字没变，但 desc 变了，为了同步地图的小气泡，后台静默更新一下地图
        renderAll();

    } catch (error) {
        console.error("保存特色失败:", error);
        alert("网络异常，保存失败。");
    } finally {
        this.disabled = false;
        this.innerText = "保存特色";
    }
};
// ==========================================
// 8. 店铺点赞逻辑
// ==========================================
document.getElementById('shop-like-btn').onclick = async function() {
    // 如果已经点过了，直接拦截
    if (this.classList.contains('liked')) return;

    // 1. 先找出当前店铺在内存里的数据
    const shop = allLocations.find(loc => loc.id === currentLocationId);
    if (!shop) return;

    // 2. 更新本地 UI 和状态
    this.classList.add('liked');
    const newLikes = (shop.likes || 0) + 1;
    this.innerHTML = `已推荐 (<span id="shop-like-count">${newLikes}</span>)`;
    
    // 3. 记录到浏览器本地，防止重复点
    let likedShops = JSON.parse(localStorage.getItem('liked_shops') || '[]');
    likedShops.push(currentLocationId);
    localStorage.setItem('liked_shops', JSON.stringify(likedShops));

    // 4. 更新内存里的数据，保证不用刷新网页数据也对得上
    shop.likes = newLikes;

    // 5. 如果地图的 Popup 里也显示了点赞数，静默更新一下地图
    renderAll(); 

    // 6. 发送给云端数据库
    try {
        await supabaseClient
            .from('locations')
            .update({ likes: newLikes })
            .eq('id', currentLocationId);
    } catch (error) {
        console.error("点赞上传失败:", error);
    }
};
// ==========================================
// 9. 菜品菜单与图片上传逻辑
// ==========================================
let currentShopIdForDish = null; // 记录当前在给哪家店加菜

// 打开添加菜品弹窗
document.getElementById('open-add-dish-btn').onclick = () => {
    currentShopIdForDish = currentLocationId;
    document.getElementById('add-dish-modal').classList.remove('hidden');
    document.getElementById('dish-name').value = '';
    document.getElementById('dish-price').value = '';
    document.getElementById('dish-image').value = '';
};
document.getElementById('close-dish-modal').onclick = () => {
    document.getElementById('add-dish-modal').classList.add('hidden');
};

// 提交菜品（包含图片上传）
document.getElementById('submit-dish-btn').onclick = async function() {
    const name = document.getElementById('dish-name').value.trim();
    const price = document.getElementById('dish-price').value.trim();
    const fileInput = document.getElementById('dish-image');
    const file = fileInput.files[0];

    if (!name) return alert("请填写菜名！");

    this.disabled = true;
    this.innerText = "上传中...";
    let imageUrl = null;

    try {
        // 🌟 核心：如果有选图片，先上传到 Supabase Storage
        if (file) {
            if (file.size > 10 * 1024 * 1024) throw new Error("原图不能超过10MB哦");
            
            // 🌟 核心：前端压缩逻辑
            this.innerText = "图片正在极速压缩...";
            const options = {
                maxSizeMB: 0.5,          // 压缩后最大 0.5MB（非常够用了）
                maxWidthOrHeight: 800,   // 最大宽/高 800 像素
                useWebWorker: true       // 开启后台压缩，不卡页面
            };
            // 执行压缩
            const compressedFile = await imageCompression(file, options);
            console.log(`压缩前: ${(file.size/1024/1024).toFixed(2)}MB, 压缩后: ${(compressedFile.size/1024/1024).toFixed(2)}MB`);

            // 生成一个随机文件名，防止重名
            const fileExt = compressedFile.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            
            this.innerText = "正在上传图片...";
             await uploadWithRetry(compressedFile, fileName);

            // 获取图片的公网访问链接
            const { data: publicUrlData } = supabaseClient.storage
                .from('food_images')
                .getPublicUrl(fileName);
            
            imageUrl = publicUrlData.publicUrl;
        }

        // 🌟 插入数据到 dishes 表
        const newDish = {
            location_id: currentShopIdForDish,
            name: name,
            price: price || "时价",
            // 直接设为 null，前端会自己处理没图片的情况
            image_url: imageUrl || null ,
            user_id: currentUserId 
        };

        const { error: insertError } = await supabaseClient.from('dishes').insert([newDish]);
        if (insertError) throw insertError;

        // 🌟 顺便更新 locations 表的 aliases（搜索联动）
        const shop = allLocations.find(l => l.id === currentShopIdForDish);
        if (shop) {
            let newAlias = shop.aliases ? `${shop.aliases},${name}` : name;
            await supabaseClient.from('locations').update({ aliases: newAlias }).eq('id', shop.id);
            shop.aliases = newAlias; // 同步本地内存
        }

        alert("🎉 菜品添加成功！");
        document.getElementById('add-dish-modal').classList.add('hidden');
        
        // 刷新菜品列表
        fetchDishes(currentShopIdForDish);

    } catch (err) {
        console.error(err);
        alert("上传失败：" + err.message);
    } finally {
        this.disabled = false;
        this.innerText = "保存菜品";
    }
};

// 拉取并渲染菜品列表
async function fetchDishes(locationId) {
    const container = document.getElementById('dishes-container');
    container.innerHTML = '<div style="padding: 10px; color: #888; font-size: 13px;">🍳 正在寻找好吃的...</div>';

    const { data, error } = await supabaseClient
        .from('dishes')
        .select('*')
        .eq('location_id', locationId)
        .eq('is_deleted', false)
        .order('likes', { ascending: false });

    if (error || data.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: #888; font-size: 13px;">暂无菜单，快来添加第一道菜吧！</div>';
        return;
    }

    currentDishesData = data; // 保存完整数据供全屏使用
    container.innerHTML = '';

    // 🌟 1. 核心：在横向模式下，最多只取前 4 个菜品
    const displayData = data.slice(0, 4);
    
    // 2. 渲染这 4 个卡片
    renderDishCards(displayData, container, false);

    // 🌟 3. 如果菜品总数超过 4 个，在末尾追加一个“展开更多”的卡片
    if (data.length > 4) {
        const expandCard = document.createElement('div');
        expandCard.className = 'expand-card';
        expandCard.innerHTML = `
            <div style="font-size: 20px; margin-bottom: 5px;">👉</div>
            <div>展开更多</div>
        `;
        
        // 绑定点击事件：打开全屏瀑布流
        expandCard.onclick = () => {
            document.getElementById('full-menu-modal').classList.remove('hidden');
            document.getElementById('full-menu-shop-name').innerText = document.getElementById('modal-title').innerText;
            const fullMenuGrid = document.getElementById('full-menu-grid');
            fullMenuGrid.innerHTML = '';
            // 渲染完整的 data
            renderDishCards(currentDishesData, fullMenuGrid, true);
            fullMenuGrid.scrollTop = 0;
            document.getElementById('scroll-to-top-btn').classList.add('hidden');
        };

        container.appendChild(expandCard);
    }
}

// 统一的渲染函数（复用于横向滑动和全屏瀑布流）
function renderDishCards(data, container, isFullScreen) {

    const likedDishes = JSON.parse(localStorage.getItem('liked_dishes') || '[]');
    
    data.forEach(dish => {
        console.log("当前用户ID:", currentUserId, "菜品作者ID:", dish.user_id);
        const hasLiked = likedDishes.includes(dish.id);
        const card = document.createElement('div');
        // 根据是不是全屏，赋予不同的 class
        card.className = isFullScreen ? 'full-dish-card' : 'dish-card';
        
        let imgHtml = '';
        if (dish.image_url) {
            imgHtml = `<img src="${dish.image_url}" alt="${dish.name}" onerror="this.outerHTML='<div class=\\'${isFullScreen ? 'no-img' : ''}\\' style=\\'width: 100%; height: ${isFullScreen ? '120px' : '80px'}; background: #e0e0e0; color: #888; display: flex; justify-content: center; align-items: center; font-size: 12px;\\'>暂无图片</div>'">`;
        } else {
            imgHtml = `<div class="${isFullScreen ? 'no-img' : ''}" style="width: 100%; height: ${isFullScreen ? '120px' : '80px'}; background: #e0e0e0; color: #888; display: flex; justify-content: center; align-items: center; font-size: 12px;">暂无图片</div>`;
        }

         // 🌟 新增：如果是自己添加的菜，显示删除小叉叉
        let deleteBtnHtml = '';
        if (dish.user_id === currentUserId) {
            deleteBtnHtml = `<div class="delete-dish-btn" title="删除菜品">🗑️</div>`;
        }

        card.innerHTML = `
            ${deleteBtnHtml}
            ${imgHtml}
            <div class="${isFullScreen ? 'full-dish-info' : 'dish-info'}">
                <div class="dish-name">${dish.name}</div>
                <div class="dish-price">${dish.price}</div>
                <button class="dish-like-btn ${hasLiked ? 'liked' : ''}">
                    👍 <span>${dish.likes || 0}</span>
                </button>
            </div>
        `;

        // 🌟 绑定删除事件
        const delBtn = card.querySelector('.delete-dish-btn');
        if (delBtn) {
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm(`确定要删除【${dish.name}】吗？`)) return;
                const { error } = await supabaseClient.from('dishes').update({ is_deleted: true }).eq('id', dish.id);
                if (!error) {
                    fetchDishes(currentLocationId);
                } else {
                    alert("删除失败");
                }
            };
        }
        // 绑定点赞逻辑
        card.querySelector('.dish-like-btn').onclick = async function() {
            if (this.classList.contains('liked')) return;
            this.classList.add('liked');
            const span = this.querySelector('span');
            span.innerText = parseInt(span.innerText) + 1;

            let currentLiked = JSON.parse(localStorage.getItem('liked_dishes') || '[]');
            currentLiked.push(dish.id);
            localStorage.setItem('liked_dishes', JSON.stringify(currentLiked));

            await supabaseClient.from('dishes').update({ likes: (dish.likes || 0) + 1 }).eq('id', dish.id);
        };

        container.appendChild(card);
    });
}
// ==========================================
// 10. 菜单展开与全屏瀑布流交互
// ==========================================
const fullMenuModal = document.getElementById('full-menu-modal');
const fullMenuGrid = document.getElementById('full-menu-grid');
const scrollTopBtn = document.getElementById('scroll-to-top-btn');


// 关闭全屏菜单
document.getElementById('close-full-menu').onclick = () => {
    fullMenuModal.classList.add('hidden');
};

// 监听全屏菜单的滚动，控制“回到顶部”按钮的显示
fullMenuGrid.addEventListener('scroll', () => {
    if (fullMenuGrid.scrollTop > 200) {
        scrollTopBtn.classList.remove('hidden');
    } else {
        scrollTopBtn.classList.add('hidden');
    }
});

// 点击回到顶部
scrollTopBtn.onclick = () => {
    fullMenuGrid.scrollTo({ top: 0, behavior: 'smooth' });
};

// 全屏模式下的悬浮添加菜品按钮
document.getElementById('floating-add-dish-btn').onclick = () => {
    // 直接把之前在详情页写的打开弹窗的逻辑拿过来用
    document.getElementById('add-dish-modal').classList.remove('hidden');
    document.getElementById('dish-name').value = '';
    document.getElementById('dish-price').value = '';
    document.getElementById('dish-image').value = '';
    // 注意：currentShopIdForDish 在详情页打开时已经赋值了，这里不用重复赋值
};
// ==========================================
// 11. 点击遮罩层关闭弹窗 (提升体验)
// ==========================================

// 把需要支持“点外部关闭”的弹窗 ID 都列出来
const modalIds = ['detail-modal', 'add-modal', 'add-dish-modal', 'profile-modal','feedback-modal','announcement-modal'];

modalIds.forEach(id => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.addEventListener('click', function(event) {
            // 🌟 核心魔法：如果点击的目标正好是灰色遮罩层本身（而不是里面的白色卡片）
            if (event.target === this) {
                this.classList.add('hidden');
            }
        });
    }
});
// ==========================================
// 12. 实时定位功能 (恢复版)
// ==========================================

// 1. 监听定位成功事件
map.on('locationfound', function(e) {
    var radius = e.accuracy / 2;
    
    // 🌟 核心修复：把浏览器拿到的原始 GPS 坐标 (WGS84) 转换成高德坐标
    var convertedLngLat = wgs84ToGcj02(e.latlng.lng, e.latlng.lat);
    var gcjLatLng = L.latLng(convertedLngLat[1], convertedLngLat[0]); // 转回 Leaflet 需要的格式

    // 移除旧的位置标记
    if (window.locationMarker) {
        map.removeLayer(window.locationMarker);
        map.removeLayer(window.locationCircle);
    }

    // 画蓝点 (用转换后的坐标 gcjLatLng)
    window.locationMarker = L.circleMarker(gcjLatLng, {
        radius: 10, fillColor: "#007bff", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.8
    }).addTo(map);

    // 画范围圈
    window.locationCircle = L.circle(gcjLatLng, radius).addTo(map);

    // 恢复按钮状态，地图飞过去 (用转换后的坐标)
    const btn = document.getElementById('locate-me-btn');
    if (btn) btn.classList.remove('loading');
    map.flyTo(gcjLatLng, 17, { duration: 1 });
});

// 2. 监听定位失败事件 (比如没给权限、超时)
map.on('locationerror', function(e) {
    const btn = document.getElementById('locate-me-btn');
    if (btn) btn.classList.remove('loading');
    alert("定位失败啦，请检查是否允许浏览器获取位置，或者走到空旷的地方再试一次哦~");
});

// ==========================================
// 13. 全屏图集预览逻辑
// ==========================================
window.currentGalleryImages = []; // 存当前店铺的所有环境图
let currentGalleryIndex = 0;

const galleryModal = document.getElementById('gallery-modal');
const galleryImg = document.getElementById('gallery-main-img');
const galleryCounter = document.getElementById('gallery-counter');

// 点击详情页的封面图，打开图集
document.getElementById('shop-env-img').onclick = () => {
    if (!window.currentGalleryImages || window.currentGalleryImages.length === 0) return;
    currentGalleryIndex = 0;
    updateGalleryView();
    galleryModal.classList.remove('hidden');
};

// 更新图集里的大图和计数
function updateGalleryView() {
    galleryImg.src = window.currentGalleryImages[currentGalleryIndex];
    galleryCounter.innerText = `${currentGalleryIndex + 1} / ${window.currentGalleryImages.length}`;
    
    // 如果只有一张图，隐藏左右按钮
    const showControls = window.currentGalleryImages.length > 1;
    document.getElementById('gallery-prev').style.display = showControls ? 'block' : 'none';
    document.getElementById('gallery-next').style.display = showControls ? 'block' : 'none';
}

// 上一张
document.getElementById('gallery-prev').onclick = (e) => {
    e.stopPropagation();
    if (currentGalleryIndex > 0) {
        currentGalleryIndex--;
        updateGalleryView();
    }
};

// 下一张
document.getElementById('gallery-next').onclick = (e) => {
    e.stopPropagation();
    if (currentGalleryIndex < window.currentGalleryImages.length - 1) {
        currentGalleryIndex++;
        updateGalleryView();
    }
};

// 关闭图集 (点叉叉或点黑边)
document.getElementById('close-gallery').onclick = () => galleryModal.classList.add('hidden');
galleryModal.onclick = (e) => {
    if (e.target === galleryModal) galleryModal.classList.add('hidden');
};

// ==========================================
// 自定义下拉框交互逻辑（修复版：事件委托）
// ==========================================
// document.getElementById('filter-bar').addEventListener('click', function(e) {
//     // 1. 如果点击的是下拉框头部（触发器）
//     const trigger = e.target.closest('.dropdown-trigger');
//     if (trigger) {
//         e.stopPropagation(); // 阻止冒泡
//         const parentDropdown = trigger.parentElement;
        
//         // 先把其他打开的菜单关掉
//         document.querySelectorAll('.custom-dropdown').forEach(dd => {
//             if (dd !== parentDropdown) dd.classList.remove('active');
//         });
        
//         // 切换自己的状态
//         parentDropdown.classList.toggle('active');
//         return; 
//     }

//     // 2. 如果点击的是下拉菜单里的选项 (LI)
//     const item = e.target.closest('.dropdown-item');
//     if (item) {
//         e.stopPropagation();
//         const value = item.dataset.value;
//         const text = item.innerText;
//         const dropdown = item.closest('.custom-dropdown');
        
//         // 更新选中样式
//         dropdown.querySelectorAll('.dropdown-item').forEach(li => li.classList.remove('active'));
//         item.classList.add('active');
        
//         // 关闭菜单
//         dropdown.classList.remove('active');
        
//         // 更新文字并触发过滤
//         if (dropdown.id === 'zone-dropdown') {
//             document.getElementById('zone-trigger-text').innerText = text;
//             currentZone = value;
//             renderAll();
//         } else if (dropdown.id === 'category-dropdown') {
//             document.getElementById('category-trigger-text').innerText = text;
//             currentCategory = value;
//             renderAll();
//         }
//     }
// });
document.getElementById('filter-bar').addEventListener('click', function(e) {
    console.log("🔥 点击了 filter-bar！");
    
    // 1. 点击下拉框头部
    const trigger = e.target.closest('.dropdown-trigger');
    if (trigger) {
        console.log("🎯 点击到了下拉框触发器！");
        e.stopPropagation();
        
        // 🌟 修复核心：直接用 closest 抓取带有 custom-dropdown 的父级，绝对抓不错
        const dropdown = trigger.closest('.custom-dropdown');
        
        // 先把其他打开的关掉
        document.querySelectorAll('.custom-dropdown').forEach(dd => {
            if (dd !== dropdown) dd.classList.remove('active');
        });
        
        // 切换自己的状态
        dropdown.classList.toggle('active');
        
        // 🌟 打印一下看看是否真的加上了
        console.log("✅ 当前下拉框的 Class 状态：", dropdown.className);
        
        return; 
    }

    // 2. 点击下拉选项
    const item = e.target.closest('.dropdown-item');
    if (item) {
        e.stopPropagation();
        const value = item.dataset.value;
        const text = item.innerText;
        const dropdown = item.closest('.custom-dropdown');
        
        dropdown.querySelectorAll('.dropdown-item').forEach(li => li.classList.remove('active'));
        item.classList.add('active');
        dropdown.classList.remove('active');
        
        if (dropdown.id === 'zone-dropdown') {
            document.getElementById('zone-trigger-text').innerText = text;
            currentZone = value;
            renderAll();
        } else if (dropdown.id === 'category-dropdown') {
            document.getElementById('category-trigger-text').innerText = text;
            currentCategory = value;
            renderAll();
        }
    }
});

// 3. 点击页面其他地方，自动关闭所有下拉框
document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown').forEach(dd => {
            dd.classList.remove('active');
        });
    }
});
// ==========================================
// 14. 意见反馈逻辑
// ==========================================

// 1. 打开反馈弹窗
document.getElementById('feedback-entry').onclick = function() {
    document.getElementById('feedback-modal').classList.remove('hidden');
    // 每次打开重置表单
    document.getElementById('fb-content').value = '';
    document.getElementById('fb-contact').value = '';
    document.getElementById('fb-image').value = '';
};

// 2. 关闭反馈弹窗
document.getElementById('close-feedback-modal').onclick = function() {
    document.getElementById('feedback-modal').classList.add('hidden');
};

// 3. 提交反馈（包含图片上传）
document.getElementById('submit-feedback-btn').onclick = async function() {
    const type = document.getElementById('fb-type').value;
    const content = document.getElementById('fb-content').value.trim();
    const contact = document.getElementById('fb-contact').value.trim();
    const file = document.getElementById('fb-image').files[0];

    if (!content) {
        alert("请写一下你遇到的问题或建议哦！");
        return;
    }

    this.disabled = true;
    this.innerText = "正在发送...";
    let imageUrl = null;

    try {
        // 如果有截图，先上传截图
        if (file) {
            this.innerText = "图片上传中...";
            const options = { maxSizeMB: 0.5, maxWidthOrHeight: 800, useWebWorker: true };
            const compressedFile = await imageCompression(file, options);
            const fileExt = compressedFile.name.split('.').pop();
            const fileName = `fb_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            
            await uploadWithRetry(compressedFile, fileName);
            const { data: publicUrlData } = supabaseClient.storage.from('food_images').getPublicUrl(fileName);
            imageUrl = publicUrlData.publicUrl;
        }

        this.innerText = "写入云端...";
        // 写入 feedbacks 表
        const newFeedback = {
            type: type,
            content: content,
            contact: contact || null,
            image_url: imageUrl || null
            // user_id 会自动由数据库的 auth.uid() 填入
        };

        const { error } = await supabaseClient.from('feedbacks').insert([newFeedback]);
        if (error) throw error;

        alert("🎉 反馈提交成功！感谢您的宝贵意见，我们会尽快处理！");
        document.getElementById('feedback-modal').classList.add('hidden');

    } catch (error) {
        console.error("反馈提交失败:", error);
        alert("发送失败了，请检查网络后重试~");
    } finally {
        this.disabled = false;
        this.innerText = "发送反馈";
    }
};

// ==========================================
// 15. 收纳工具栏交互逻辑
// ==========================================

// 1. 展开/收起主菜单
const fabContainer = document.getElementById('fab-container');
document.getElementById('fab-main-btn').onclick = function(e) {
    e.stopPropagation(); // 阻止冒泡
    fabContainer.classList.toggle('active');
};

// 2. 点击页面其他地方自动收起
document.addEventListener('click', function(e) {
    if (!e.target.closest('#fab-container')) {
        fabContainer.classList.remove('active');
    }
});

// 3. 绑定子按钮的事件（替换原有的）
// 定位按钮
document.getElementById('btn-locate').onclick = function() {
    fabContainer.classList.remove('active'); // 点击后收起菜单
    this.classList.add('loading');
    map.locate({ setView: false, maxZoom: 17, enableHighAccuracy: true });
};

// 添加店铺按钮 (这里调用原本的点击事件)
document.getElementById('btn-add').onclick = function() {
    fabContainer.classList.remove('active'); 
    // 这里填入你原来 add-place-btn 的逻辑，或者直接触发原按钮
    document.getElementById('add-modal').classList.remove('hidden');
    // 重置表单
    document.getElementById('add-is-online').value = '仅线下';
    document.getElementById('add-zone').value = '';
    document.getElementById('custom-zone-input').style.display = 'none';
    document.getElementById('add-name').value = '';
    document.getElementById('add-feature').value = '';
    document.getElementById('existing-shops-tip').innerHTML = ''; // 清空提示
    document.getElementById('add-contact').value = '';
    document.getElementById('add-env-image').value = '';
    updateAddFormVisibility();
    const statusText = document.getElementById('add-location-status');
    statusText.style.display = 'block';
    statusText.innerText = "📍 正在获取您的当前位置...";
    statusText.style.color = "#888";
    tempLat = null;
    tempLng = null;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                var convertedLngLat = wgs84ToGcj02(position.coords.longitude, position.coords.latitude);
                tempLng = convertedLngLat[0];
                tempLat = convertedLngLat[1];

                statusText.innerText = `✅ 定位成功！店铺将添加在您当前位置。`;
                statusText.style.color = "#4CAF50";
            },
            function(error) {
                statusText.innerText = "❌ 无法获取定位，将默认使用地图中心点。";
                statusText.style.color = "#ff5722";
                const center = map.getCenter();
                tempLat = center.lat;
                tempLng = center.lng;
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }
};

// 个人中心按钮
document.getElementById('btn-profile').onclick = function() {
    fabContainer.classList.remove('active');
    document.getElementById('profile-modal').classList.remove('hidden');
    fetchMyComments();
};
// 公告按钮
document.getElementById('btn-announcement').onclick = function() {
    fabContainer.classList.remove('active'); // 收起菜单
    document.getElementById('announcement-modal').classList.remove('hidden');
};

// 关闭公告弹窗的多种方式
document.getElementById('close-announcement').onclick = () => {
    document.getElementById('announcement-modal').classList.add('hidden');
};
document.getElementById('agree-announcement').onclick = () => {
    document.getElementById('announcement-modal').classList.add('hidden');
};
// ==========================================
// 16. 加载小贴士逻辑
// ==========================================
const TIPS_LIST = [
    "双击地图上的小图钉，可以查看店铺的详细信息和图集哦~",
    "不知道吃什么？点开菜单里的随机推荐试试手气吧！",
    "所有店铺均由同学们真实添加，点赞可以帮它排到前面~",
    "如果发现重复或虚假的店铺，可以在个人中心提交意见反馈。",
    "在搜索框里不仅可以搜店名，还可以搜菜品和区域！"
];

function showLoadingTip() {
    // 检查本次会话是否已经看过了
    if (sessionStorage.getItem('hasSeenTip')) return;

    const tipBox = document.getElementById('loading-tip');
    const tipText = document.getElementById('tip-text');
    
    // 随机选一条
    const randomTip = TIPS_LIST[Math.floor(Math.random() * TIPS_LIST.length)];
    tipText.innerText = randomTip;
    
    // 延迟 500ms 显示，让它有“弹出来”的视觉效果
    setTimeout(() => {
        tipBox.classList.remove('hidden');
        // 强制浏览器重绘一下，保证动画生效
        void tipBox.offsetWidth; 
        tipBox.classList.add('show');
    }, 500);

    // 标记已阅
    sessionStorage.setItem('hasSeenTip', 'true');

    // 点击卡片直接关闭
    tipBox.onclick = () => {
        tipBox.classList.remove('show');
        setTimeout(() => tipBox.classList.add('hidden'), 400);
    };

    // 如果过了 4 秒钟，自动优雅退场
    setTimeout(() => {
        tipBox.classList.remove('show');
        setTimeout(() => tipBox.classList.add('hidden'), 400);
    }, 4500);
}

// 启动程序时调用它
showLoadingTip();
// ==========================================
// 17. 随机盲盒逻辑
// ==========================================
let currentRandomType = 'shop'; // 默认抽店铺
let isRolling = false; // 防止重复点击

// 打开弹窗
document.getElementById('btn-random').onclick = () => {
    fabContainer.classList.remove('active');
    document.getElementById('random-modal').classList.remove('hidden');
};

// 关闭弹窗
document.getElementById('close-random').onclick = () => {
    if (isRolling) return;
    document.getElementById('random-modal').classList.add('hidden');
};

// 切换选项卡
document.querySelectorAll('.random-tab').forEach(tab => {
    tab.onclick = function() {
        if (isRolling) return;
        document.querySelectorAll('.random-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentRandomType = this.dataset.type;
        
        document.getElementById('random-result-name').innerText = "准备好了吗？";
        document.getElementById('random-result-sub').innerText = "点击下方按钮开始抽取";
    };
});

// 点击开始抽奖
document.getElementById('start-random-btn').onclick = function() {
    if (isRolling) return;

    // 检查数据量
    if (currentRandomType === 'shop' && allLocations.length === 0) return alert("店里还没数据呢！");
    if (currentRandomType === 'dish' && allDishesList.length === 0) return alert("大家还没添加菜品哦！");

    const nameBox = document.getElementById('random-result-name');
    const subBox = document.getElementById('random-result-sub');
    
    isRolling = true;
    nameBox.classList.add('rolling');
    this.innerText = "抽取中...";
    this.disabled = true;

    // 模拟老虎机滚动
    let rollCount = 0;
    const rollInterval = setInterval(() => {
        if (currentRandomType === 'shop') {
            const randomItem = allLocations[Math.floor(Math.random() * allLocations.length)];
            nameBox.innerText = randomItem.name;
        } else {
            const randomItem = allDishesList[Math.floor(Math.random() * allDishesList.length)];
            nameBox.innerText = randomItem.name;
        }
        rollCount++;
    }, 50);

    // 1.5秒后停止
    setTimeout(() => {
        clearInterval(rollInterval);
        nameBox.classList.remove('rolling');
        isRolling = false;
        this.innerText = "再抽一次！";
        this.disabled = false;

        // 决定最终结果
        if (currentRandomType === 'shop') {
            const finalShop = allLocations[Math.floor(Math.random() * allLocations.length)];
            nameBox.innerText = finalShop.name;
            subBox.innerHTML = `📍 ${finalShop.zone || '未知区域'} | 均价：${finalShop.price || '?'}<br><span style="color:#2196F3; cursor:pointer; text-decoration:underline; margin-top:5px; display:inline-block;" onclick="flyToRandomResult('${finalShop.id}')">点击带我去这里</span>`;
        } else {
            const finalDish = allDishesList[Math.floor(Math.random() * allDishesList.length)];
            const parentShop = allLocations.find(s => s.id === finalDish.location_id);
            const shopName = parentShop ? parentShop.name : '未知店铺';
            
            nameBox.innerText = finalDish.name;
            subBox.innerHTML = `🏪 来自：${shopName} | 价格：${finalDish.price}<br><span style="color:#2196F3; cursor:pointer; text-decoration:underline; margin-top:5px; display:inline-block;" onclick="flyToRandomResult('${finalDish.location_id}')">点击带我去这家店</span>`;
        }
    }, 1500);
};

// 抽奖后，点击结果直达店铺
window.flyToRandomResult = function(shopId) {
    const shop = allLocations.find(s => s.id == shopId);
    if (!shop) return;

    document.getElementById('random-modal').classList.add('hidden');
    
    // 如果店铺没被过滤掉，直接飞过去并打开详情
    if (shop.is_online === '仅线上') {
        openDetailCard(shop);
    } else {
        map.flyTo([parseFloat(shop.lat), parseFloat(shop.lng)], 18, { duration: 1.5 });
        setTimeout(() => {
            openDetailCard(shop);
        }, 1500);
    }
};
// ==========================================
// 5. 启动程序
// ==========================================
fetchDataFromCloud();