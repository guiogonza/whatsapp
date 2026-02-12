const axios = require('axios');

const GPSWOX_CONFIG = {
    BASE_URL: 'http://142.132.149.111/api',
    API_HASH: '$2y$10$olDjm0MFRwAAszdePy4H6.W2oXAAx7jht7jPlx3.qxunehfBA6.n2'
};

async function checkDeviceFields() {
    try {
        const response = await axios.get(`${GPSWOX_CONFIG.BASE_URL}/get_devices`, {
            params: {
                lang: 'en',
                user_api_hash: GPSWOX_CONFIG.API_HASH
            }
        });
        
        const groups = response.data;
        if (Array.isArray(groups) && groups.length > 0) {
            const firstDevice = groups[0].items?.[0];
            if (firstDevice) {
                console.log('=== Campos disponibles en un device ===');
                console.log(JSON.stringify(firstDevice, null, 2));
            } else {
                console.log('No hay devices en el primer grupo');
            }
        } else {
            console.log('No hay grupos');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkDeviceFields();
