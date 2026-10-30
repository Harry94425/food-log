import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTheme } from './theme';

type Props = {
  visible: boolean;
  onScanned: (barcode: string) => void;
  onClose: () => void;
};

/** 全螢幕相機掃商品條碼（EAN-13 / EAN-8 / UPC） */
export function BarcodeScanner({ visible, onScanned, onClose }: Props) {
  const { ui } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  // 相機會連續回報同一個條碼，只處理第一次
  const done = useRef(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        done.current = false;
      }}
    >
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              done.current = true;
              onScanned(data);
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>需要相機權限才能掃條碼</Text>
            <Pressable style={ui.button} onPress={requestPermission}>
              <Text style={ui.buttonText}>允許使用相機</Text>
            </Pressable>
          </View>
        )}

        {/* 對準框 */}
        {permission?.granted && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ width: '80%', height: 140, borderWidth: 2, borderColor: '#fff', borderRadius: 12 }} />
            <Text style={{ color: '#fff', marginTop: 12 }}>把條碼對準框內</Text>
          </View>
        )}

        <Pressable
          onPress={onClose}
          style={[ui.button, { position: 'absolute', bottom: 48, alignSelf: 'center', paddingHorizontal: 32 }]}
        >
          <Text style={ui.buttonText}>取消</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
