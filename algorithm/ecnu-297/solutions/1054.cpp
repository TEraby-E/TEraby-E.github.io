#include <iostream>
using namespace std;

int main() {
    long long ways[101] = {};
    ways[0] = 1;
    // 按拆分项从小到大处理，同一多重集合只会统计一次。
    for (int part = 1; part <= 100; ++part)
        for (int total = part; total <= 100; ++total)
            ways[total] += ways[total - part];

    int n;
    while (cin >> n) cout << ways[n] << '\n';
    return 0;
}
