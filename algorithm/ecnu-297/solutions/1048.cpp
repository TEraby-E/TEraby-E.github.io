#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    long long phoneTime;
    if (!(cin >> n >> phoneTime)) return 0;
    vector<long long> position(n);
    for (long long &x : position) cin >> x;
    sort(position.begin(), position.end());

    long long answer = n * phoneTime;
    for (int i = 0; i < n; ++i) {
        // 骑车到第 i 户再回来，沿途所有住户都顺便送到。
        long long time = 2 * position[i] + (n - i - 1) * phoneTime;
        answer = min(answer, time);
    }
    cout << answer << '\n';
    return 0;
}
