import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

// Approximate rendered width of "מי בגינה" at fontSize 30 fontWeight 800.
// Adjust slightly if text clips on a physical device.
const TEXT_WIDTH = 130;
const ROW_HEIGHT = 44;

export function SplashAnimation({ onDone }: { onDone: () => void }) {
  const treeScale   = useRef(new Animated.Value(0)).current;
  const textWidth   = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. Tree pops into center (spring, native driver)
      Animated.spring(treeScale, {
        toValue: 1,
        friction: 5,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.delay(320),
      // 2. "מי בגינה" rolls out from tree rightward to left (non-native driver)
      //    Acceptable: one-time splash, ~480ms
      Animated.timing(textWidth, {
        toValue: TEXT_WIDTH,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.delay(700),
      // 3. Fade out (native driver)
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start(onDone);
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: overlayOpacity }]}>
      {/*
        Flex row — centered on screen.
        When textWidth = 0: row = [0px container] + [tree], tree is centered.
        As textWidth grows: row expands left, tree drifts right (natural flex centering).
        Text is anchored to the container's right edge (position absolute, right: 0)
        so it reveals from the tree side outward — "rolls out of the tree."
      */}
      <View style={styles.row}>
        <Animated.View style={[styles.textClip, { width: textWidth }]}>
          <Text style={styles.text} numberOfLines={1}>מי בגינה</Text>
        </Animated.View>
        <Animated.Image
          source={require('../assets/tree.png')}
          style={[styles.tree, { transform: [{ scale: treeScale }] }]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  row: {
    // row-reverse in RTL = left-to-right: [textClip LEFT][tree RIGHT]
    // Text reveals from tree side (right) outward to the left. ✓
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  textClip: {
    overflow: 'hidden',
    height: ROW_HEIGHT,
    // marginRight keeps a small gap between text and tree
    marginRight: 5,
  },
  text: {
    // Anchored to the RIGHT edge of the clip container so it reveals
    // from the tree side (right) toward the left as the container grows.
    position: 'absolute',
    right: 0,
    width: TEXT_WIDTH,
    height: ROW_HEIGHT,
    lineHeight: ROW_HEIGHT,
    fontSize: 30,
    fontWeight: '800',
    color: '#111A13',
    textAlign: 'right',
  },
  tree: {
    width: 44,
    height: 44,
  },
});
