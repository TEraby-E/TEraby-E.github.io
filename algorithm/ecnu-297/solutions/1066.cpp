#include <iostream>
using namespace std;

int main() {
    int n;
    while (cin >> n) {
        // 最大的两个同尺寸盘可连续搬到终点，小塔在其前后各搬一次。
        // f(n) = 2 f(n-1) + 2，f(0) = 0。
        cout << (1ULL << (n + 1)) - 2 << '\n';
    }
    return 0;
}
