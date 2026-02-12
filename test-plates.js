/**
 * Script de prueba para verificar placas en GPSwox
 */

const axios = require('axios');

const GPSWOX_CONFIG = {
    BASE_URL: 'http://142.132.149.111/api',
    API_HASH: '$2y$10$olDjm0MFRwAAszdePy4H6.W2oXAAx7jht7jPlx3.qxunehfBA6.n2',
};

async function listAllDevices() {
    try {
        const url = `${GPSWOX_CONFIG.BASE_URL}/get_devices`;
        const response = await axios.get(url, {
            params: {
                lang: 'en',
                user_api_hash: GPSWOX_CONFIG.API_HASH
            },
            timeout: 30000
        });

        const groups = response.data;
        
        console.log(`\n📋 Total grupos: ${groups.length}\n`);
        
        let totalDevices = 0;
        const allPlates = [];
        
        for (const group of groups) {
            const items = group.items || [];
            totalDevices += items.length;
            
            console.log(`\n🗂️  Grupo: ${group.title || group.id} (${items.length} dispositivos)`);
            
            for (const device of items) {
                const plate = device.name || 'SIN PLACA';
                allPlates.push(plate);
                console.log(`   📍 ${plate} (ID: ${device.id}, online: ${device.online ? '🟢' : '🔴'})`);
            }
        }
        
        console.log(`\n\n✅ Total dispositivos: ${totalDevices}`);
        
        // Buscar IMU148 específicamente
        console.log(`\n\n🔍 Buscando placas que contengan 'IMU':`);
        const imuPlates = allPlates.filter(p => p.toUpperCase().includes('IMU'));
        if (imuPlates.length > 0) {
            imuPlates.forEach(p => console.log(`   ✓ ${p}`));
        } else {
            console.log(`   ❌ No se encontraron placas con 'IMU'`);
        }
        
        // Buscar IMU148 exacto con diferentes formatos
        console.log(`\n\n🔍 Buscando IMU148 en diferentes formatos:`);
        const variations = ['IMU148', 'IMU-148', 'imu148', 'imu-148'];
        variations.forEach(v => {
            const found = allPlates.find(p => p.toUpperCase() === v.toUpperCase());
            console.log(`   ${v}: ${found ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO'}`);
        });

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
        }
    }
}

listAllDevices();
